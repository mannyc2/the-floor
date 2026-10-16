import { Signer, SignerError } from "@floor/chains/signer";
import { chainCheckpoint } from "@floor/chains/solana/read-pool";
import { SolanaReader } from "@floor/chains/solana/reader";
import { rpcResult, SolanaRpc } from "@floor/chains/solana/rpc";
import { MeteoraSwap } from "@floor/chains/solana/swap";
import {
  AgentId,
  ChainRef,
  Digest,
  ForkPolicy,
  IntentId,
  OwnerId,
  PolicyDecision,
  Receipt,
  ReceiptCause,
  ReceiptId,
  SwapIntent,
  TransactionRef,
} from "@floor/contract";
import { Array, DateTime, Effect, Layer, Option, Schedule, Schema, Semaphore } from "effect";
import { Base64 } from "effect/encoding";
import { ForkKey } from "./fork-key";
import { SubmissionJournal } from "./journal";

export const ForkConfiguration = Schema.Struct({
  endpoint: Schema.String,
  genesisHash: Digest,
  owner: OwnerId,
  agent: AgentId,
  pool: Schema.String,
  inputTokenAccount: Schema.String,
  outputTokenAccount: Schema.String,
  // This denomination belongs to the disposable fork mint, never to a live market quote.
  quoteDecimals: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 18 })),
});
export type ForkConfiguration = typeof ForkConfiguration.Type;
const LatestBlockhash = Schema.Struct({
  value: Schema.Struct({ blockhash: Schema.String, lastValidBlockHeight: Schema.Natural }),
});
const Simulation = Schema.Struct({
  value: Schema.Struct({
    err: Schema.OptionFromNullOr(Schema.Json),
    logs: Schema.OptionFromNullOr(Schema.Array(Schema.String)),
  }),
});
const SignatureStatus = Schema.Struct({
  value: Schema.Array(
    Schema.OptionFromNullOr(
      Schema.Struct({
        slot: Schema.Natural,
        err: Schema.OptionFromNullOr(Schema.Json),
        confirmationStatus: Schema.OptionFromNullOr(Schema.Literals(["processed", "confirmed", "finalized"])),
      }),
    ),
  ),
});
const intentEquals = Schema.toEquivalence(SwapIntent);

export const forkSignerLayer = (configuration: ForkConfiguration) =>
  Layer.effect(
    Signer,
    Effect.gen(function*() {
      const rpc = yield* SolanaRpc;
      const key = yield* ForkKey;
      const reader = yield* SolanaReader;
      const swap = yield* MeteoraSwap;
      const journal = yield* SubmissionJournal;
      const gate = yield* Semaphore.make(1);
      const chain = ChainRef.make(`solana:${configuration.genesisHash.slice(0, 32)}`);
      const policy = ForkPolicy.make({ owner: configuration.owner, genesisHash: configuration.genesisHash });

      const store = Effect.fn("Signer.store")(function*(receipt: Receipt) {
        yield* journal.write(receipt);
        return receipt;
      });
      const refusal = Effect.fn("Signer.refuse")(
        function*(intent: SwapIntent, code: "simulationFailed" | "unsupportedAction" | "unavailable", detail: string) {
          return yield* store(Receipt.cases.RefusedReceipt.make({
            id: ReceiptId.make(intent.id),
            action: intent,
            causes: [ReceiptCause.cases.AgentIntent.make({ agent: intent.agent, intent: intent.id })],
            recordedAt: yield* DateTime.now,
            policy: PolicyDecision.cases.Allowed.make({ policy }),
            refusal: { code, detail },
          }));
        },
      );
      const settleReceipt = Effect.fn("Signer.settleReceipt")(function*(receipt: Receipt) {
        if (receipt._tag !== "UnknownReceipt" || Option.isNone(receipt.transaction)) return receipt;
        yield* key.verify;
        const statusReply = yield* rpcResult(rpc, SignatureStatus, "getSignatureStatuses", [[
          receipt.transaction.value.hash,
        ], { searchTransactionHistory: true }]);
        const status = Array.head(statusReply.value).pipe(Option.flatten);
        const now = yield* DateTime.now;
        if (
          Option.isNone(status) || Option.isNone(status.value.confirmationStatus)
          || status.value.confirmationStatus.value === "processed"
        ) {
          return yield* store(
            Receipt.make({
              ...receipt,
              lastCheckedAt: Option.some(now),
              reason: "The fork has not confirmed this signature; it has not been resubmitted",
            }),
          );
        }
        const checkpoint = yield* chainCheckpoint(rpc, chain, status.value.slot);
        return yield* store(Receipt.cases.SettledReceipt.make({
          id: receipt.id,
          action: receipt.action,
          causes: receipt.causes,
          recordedAt: now,
          policy,
          transaction: receipt.transaction.value,
          checkpoint,
          result: Option.isNone(status.value.err) ? "succeeded" : "failed",
        }));
      });
      const submit = Effect.fn("Signer.submit")(
        function*(intent: SwapIntent) {
          if (intent.owner !== configuration.owner || intent.agent !== configuration.agent || intent.chain !== chain) {
            return yield* new SignerError({
              operation: "submit.identity",
              cause: "Intent owner, agent and chain must match the configured fork wallet",
            });
          }
          const existing = yield* journal.read(intent.id);
          if (Option.isSome(existing)) {
            if (existing.value.action._tag !== "Swap" || !intentEquals(existing.value.action, intent)) {
              return yield* new SignerError({
                operation: "submit.intentConflict",
                cause: "An intent identifier cannot name different actions",
              });
            }
            return yield* settleReceipt(existing.value);
          }
          yield* key.verify;
          const pool = yield* reader.getPool(configuration.pool);
          if (
            intent.sell !== `${chain}/token:${pool.quoteMint}` || intent.buy !== `${chain}/token:${pool.baseMint}`
            || pool.sqrtPrice <= 0n
          ) {
            return yield* refusal(
              intent,
              "unsupportedAction",
              "This fork signer supports only its configured quote-to-base pool",
            );
          }
          const decimalShift = configuration.quoteDecimals - intent.dollars.scale;
          const divisor = decimalShift < 0 ? 10n ** BigInt(-decimalShift) : 1n;
          const amountIn = decimalShift < 0
            ? intent.dollars.value / divisor
            : intent.dollars.value * 10n ** BigInt(decimalShift);
          if (intent.dollars.value % divisor !== 0n || amountIn <= 0n || amountIn > (1n << 64n) - 1n) {
            return yield* refusal(
              intent,
              "unsupportedAction",
              "The fork-dollar amount must be exactly representable in quote-token atoms",
            );
          }
          // A marginal pool price anchors the cap, including fee and price impact.
          // Rounding the permitted loss down can only make the on-chain limit stricter.
          const referenceOut = amountIn * (1n << 128n) / (pool.sqrtPrice * pool.sqrtPrice);
          const minimumAmountOut = referenceOut
            - referenceOut * BigInt(Math.floor(intent.slippageCap * 1_000_000)) / 1_000_000n;
          const lifetime = yield* rpcResult(rpc, LatestBlockhash, "getLatestBlockhash", [{ commitment: "confirmed" }]);
          const unsigned = yield* swap.construct({
            intentId: intent.id,
            payer: key.payer,
            pool,
            inputTokenAccount: configuration.inputTokenAccount,
            outputTokenAccount: configuration.outputTokenAccount,
            amountIn,
            minimumAmountOut,
            blockhash: lifetime.value.blockhash,
            lastValidBlockHeight: BigInt(lifetime.value.lastValidBlockHeight),
          });
          const simulation = yield* rpcResult(rpc, Simulation, "simulateTransaction", [Base64.encode(unsigned), {
            encoding: "base64",
            sigVerify: false,
            commitment: "confirmed",
          }]);
          if (Option.isSome(simulation.value.err)) {
            const lastLog = simulation.value.logs.pipe(
              Option.flatMap(Array.last),
              Option.getOrElse(() => "The unsigned transaction failed simulation"),
            );
            return yield* refusal(
              intent,
              "simulationFailed",
              lastLog.slice(0, 256),
            );
          }
          const signed = yield* key.sign(unsigned);
          const transaction = TransactionRef.make({ chain, hash: Digest.make(signed.signature) });
          // Persist uncertainty before the only broadcast. A crash between these lines
          // leaves an inspectable signature; another submit only reads the chain.
          const pending = yield* store(Receipt.cases.UnknownReceipt.make({
            id: ReceiptId.make(intent.id),
            action: intent,
            causes: [ReceiptCause.cases.AgentIntent.make({ agent: intent.agent, intent: intent.id })],
            recordedAt: yield* DateTime.now,
            policy,
            submission: Digest.make(signed.signature),
            transaction: Option.some(transaction),
            lastCheckedAt: Option.none(),
            reason: "Signature journaled before submission; settlement is not yet known",
          }));
          const sent = yield* rpcResult(rpc, Schema.String, "sendTransaction", [signed.transaction, {
            encoding: "base64",
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 0,
          }]).pipe(Effect.result);
          if (sent._tag === "Failure") return pending;
          if (sent.success !== signed.signature) {
            return pending;
          }
          return yield* settleReceipt(pending).pipe(
            Effect.repeat({
              while: receipt => receipt._tag === "UnknownReceipt",
              schedule: Schedule.spaced("100 millis"),
              times: 20,
            }),
            Effect.orElseSucceed(() => pending),
          );
        },
        Effect.mapError(cause => new SignerError({ operation: "submit", cause })),
        effect => gate.withPermit(effect),
      );
      const settle = Effect.fn("Signer.settle")(
        function*(id: IntentId) {
          const receipt = yield* journal.read(id);
          if (Option.isNone(receipt)) return yield* new SignerError({ operation: "settle.missing", cause: id });
          return yield* settleReceipt(receipt.value);
        },
        Effect.mapError(cause => new SignerError({ operation: "settle", cause })),
        effect => gate.withPermit(effect),
      );
      return Signer.of({ submit, settle });
    }),
  );
