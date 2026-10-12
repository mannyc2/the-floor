import { Address, type Agent, type Note, PositionEvidence, undisclosedPosition } from "@floor/contract";
import { ScopedAccounts } from "@floor/signing";
import { Config, Context, DateTime, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { FloorDatabase } from "./store";

export class PositionReadError extends Schema.TaggedError<PositionReadError>()("PositionReadError", {
  message: Schema.String,
}) {}
export interface PositionRequest {
  readonly marketId: string;
  readonly chainId: number;
  readonly tokenAddress: string;
}
export type CheckedPosition =
  | { readonly status: "verified"; readonly position: Note["position"]; readonly evidence: PositionEvidence }
  | { readonly status: "unavailable"; readonly reason: string };
const unavailable = (reason: string): CheckedPosition => ({ status: "unavailable", reason });
const rpc = <A>(request: () => Promise<A>) =>
  Effect.tryPromise({
    try: request,
    catch: () => new PositionReadError({ message: "The token balance could not be read at a single current block." }),
  });

/** Read-only chain edge. Owner/account authority remains the responsibility of NotePositions. */
export class PositionChain extends Context.Service<PositionChain, {
  read(
    account: typeof Address.Type,
    token: typeof Address.Type,
    chainId: number,
  ): Effect.Effect<PositionEvidence, PositionReadError>;
}>()("floor/PositionChain") {
  static readonly layer = Layer.effect(
    PositionChain,
    Effect.gen(function*() {
      const url = yield* Config.URL("BASE_SEPOLIA_RPC_URL").pipe(
        Config.withDefault(new URL("https://sepolia.base.org")),
      );
      const client = createPublicClient({ transport: http(url.toString(), { timeout: 8000, retryCount: 0 }) });
      const capacity = yield* Semaphore.make(4);
      return PositionChain.of({
        read: Effect.fn("PositionChain.read")(
          function*(account, token, chainId) {
            if (chainId !== 84532 || (yield* rpc(() => client.getChainId())) !== chainId) {
              return yield* new PositionReadError({
                message: "The holdings RPC does not match the bound account chain.",
              });
            }
            const before = yield* rpc(() => client.getBlock({ blockTag: "latest" }));
            const blockNumber = yield* Effect.fromOption(Option.fromNullishOr(before.number));
            const [balance, supply, decimals, symbol] = yield* Effect.all([
              rpc(() =>
                client.readContract({
                  address: token,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [account],
                  blockNumber,
                })
              ),
              rpc(() =>
                client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply", blockNumber })
              ),
              rpc(() => client.readContract({ address: token, abi: erc20Abi, functionName: "decimals", blockNumber })),
              rpc(() => client.readContract({ address: token, abi: erc20Abi, functionName: "symbol", blockNumber })),
            ], { concurrency: 4 });
            const after = yield* rpc(() => client.getBlock({ blockNumber }));
            if (before.hash !== after.hash || supply <= 0n || balance > supply) {
              return yield* new PositionReadError({
                message: "The holdings source block or token supply could not be verified.",
              });
            }
            return yield* Schema.decodeEffect(PositionEvidence)({
              account,
              chainId,
              tokenAddress: token,
              balanceBaseUnits: balance.toString(),
              supplyBaseUnits: supply.toString(),
              decimals,
              symbol,
              blockNumber: Number(blockNumber),
              blockHash: after.hash,
              observedAt: DateTime.formatIso(yield* DateTime.now),
              sourceUrl: `https://sepolia.basescan.org/block/${blockNumber}`,
            });
          },
          capacity.withPermits(1),
          Effect.timeout("12 seconds"),
          Effect.mapError(() =>
            new PositionReadError({ message: "A current, matching-chain token balance could not be verified." })
          ),
        ),
      });
    }),
  );
}

const checkedDisclosure = (evidence: PositionEvidence): CheckedPosition => {
  const balance = BigInt(evidence.balanceBaseUnits);
  const supply = BigInt(evidence.supplyBaseUnits);
  return {
    status: "verified",
    evidence,
    position: {
      disclosure: "disclosed",
      amount: formatUnits(balance, evidence.decimals),
      symbol: evidence.symbol,
      // Preserve exact integers in evidence; this rounded percentage is display-only.
      supplyPercent: Number(balance * 100_000_000n / supply) / 1_000_000,
    },
  };
};

const makePositions = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  const accounts = yield* ScopedAccounts;
  const chain = yield* PositionChain;
  const read = Effect.fn("NotePositions.read")(function*(agent: Agent, requests: readonly PositionRequest[]) {
    const attempt = Effect.gen(function*() {
      const owner = yield* db.owners.findById(agent.owner);
      const ownerAddress = Option.fromNullishOr(owner.walletAddress);
      if (!accounts.status.configured || owner.mode !== "wallet" || Option.isNone(ownerAddress)) {
        return requests.map(request =>
          [request.marketId, unavailable("No owner-authorized account is linked for a holdings check.")] as const
        );
      }
      const address = yield* Schema.decodeUnknownEffect(Address)(ownerAddress.value);
      const binding = yield* accounts.binding(owner.id, address, agent.id, agent.policy);
      const linked = yield* accounts.read(binding);
      if (Option.isNone(linked)) {
        return requests.map(request =>
          [request.marketId, unavailable("The signing provider could not verify this desk's account binding.")] as const
        );
      }
      const account = linked.value;
      if (
        Option.exists(
          Option.fromNullishOr(agent.walletAddress),
          stored => stored.toLowerCase() !== account.account.toLowerCase(),
        )
      ) {
        return requests.map(request =>
          [request.marketId, unavailable("The verified account differs from the account bound to this desk.")] as const
        );
      }
      return yield* Effect.forEach(requests, request => {
        if (request.chainId !== account.chainId) {
          return Effect.succeed(
            [
              request.marketId,
              unavailable(
                `Market chain ${request.chainId} does not match the linked account chain ${account.chainId}; a testnet receipt cannot establish a holding on another chain.`,
              ),
            ] as const,
          );
        }
        return Schema.decodeUnknownEffect(Address)(request.tokenAddress).pipe(
          Effect.flatMap(token => chain.read(account.account, token, account.chainId)),
          Effect.map(checkedDisclosure),
          Effect.orElseSucceed(() => unavailable("The token balance at writing time could not be verified.")),
          Effect.map(position => [request.marketId, position] as const),
        );
      }, { concurrency: 4 });
    });
    return new Map(
      yield* attempt.pipe(
        Effect.orElseSucceed(() =>
          requests.map(request =>
            [request.marketId, unavailable("Owner-bound holdings evidence is currently unavailable.")] as const
          )
        ),
      ),
    );
  });
  return { read };
});
/** @stability unstable */
export class NotePositions
  extends Context.Service<NotePositions, Effect.Success<typeof makePositions>>()("floor/NotePositions")
{
  static readonly layer = Layer.effect(NotePositions, makePositions);
}

export function stampPosition(
  note: Note,
  visibility: Agent["visibility"],
  position: Option.Option<CheckedPosition>,
): Note {
  const checked = Option.getOrElse(position, () => unavailable("No matching market exists for a holdings check."));
  if (checked.status === "unavailable") {
    return {
      ...note,
      position: undisclosedPosition,
      // oxlint-disable-next-line effect/noNullish -- The persisted note DTO must explicitly remove any unverified/model-supplied provenance.
      positionEvidence: null,
      visibility: "private",
      publicationReason: `Publication pending: ${checked.reason}`,
    };
  }
  return {
    ...note,
    position: checked.position,
    positionEvidence: checked.evidence,
    createdAt: checked.evidence.observedAt,
    visibility: note.sources.length > 0 ? visibility : "private",
    publicationReason: Option.getOrNull(
      note.sources.length > 0
        ? Option.none<string>()
        : Option.some("Publication pending: at least one source is required."),
    ),
  };
}
