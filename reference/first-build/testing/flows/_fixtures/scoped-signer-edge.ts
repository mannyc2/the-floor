import {
  AccountBinding,
  AccountQuote,
  AccountReadResponse,
  DispatchRequest,
  DispatchResponse,
  fingerprintProposal,
  PreparedExecution,
  PrepareRequest,
  QuoteRequest,
  ScopedAccount,
} from "@floor/signing";
import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { keccak256, toFunctionSelector } from "viem";
import { chainCall, scopedAccountAbi } from "./anvil";
import { encodeProposalCall, FinancialChain, nativeAsset, permissionId } from "./financial-chain";

export class SignerTrace extends Context.Service<SignerTrace, {
  readonly requests: Ref.Ref<readonly string[]>;
  readonly dispatches: Ref.Ref<number>;
}>()("flow/SignerTrace") {}

const makeEdge = Effect.gen(function*() {
  const node = yield* FinancialChain;
  const requests = yield* Ref.make<readonly string[]>([]);
  const dispatches = yield* Ref.make(0);
  const prepared = yield* Ref.make(Option.none<PreparedExecution>());
  const blockNumber = chainCall(
    "A local evidence block was unavailable",
    () => node.chain.getBlockNumber({ cacheTime: 0 }),
  ).pipe(
    Effect.map(Number),
  );
  const read = Effect.fn("RecordedSigner.read")(function*(binding: AccountBinding) {
    const now = yield* DateTime.now;
    const account = ScopedAccount.make({
      binding,
      account: node.address,
      chainId: 84532,
      permissionId,
      observedAt: now,
      expiresAt: DateTime.add(now, { hours: 1 }),
      blockNumber: yield* blockNumber,
      ownerVerified: true,
      moduleEnforced: true,
      permissions: [
        {
          contract: node.curve,
          method: "buy",
          selector: toFunctionSelector("buy(uint256)"),
          asset: nativeAsset,
          recipient: node.address,
          maximumAmount: "1000000000000000000",
          maximumNativeValue: "1000000000000000000",
        },
        {
          contract: node.factory,
          method: "launch",
          selector: toFunctionSelector("launch(bytes32,string,string,uint256,uint256,uint256,uint256,bytes32)"),
          asset: nativeAsset,
          recipient: node.address,
          maximumAmount: "100000000000000000000000000",
          maximumNativeValue: "0",
        },
        {
          contract: node.address,
          method: "withdrawToOwner",
          selector: toFunctionSelector("withdrawToOwner(uint256)"),
          asset: nativeAsset,
          recipient: node.owner.account.address,
          maximumAmount: "1000000000000000000",
          maximumNativeValue: "0",
        },
      ],
    });
    return yield* Schema.encodeEffect(Schema.fromJsonString(AccountReadResponse))({ status: "verified", account });
  });
  const quote = Effect.fn("RecordedSigner.quote")(function*(request: typeof QuoteRequest.Type) {
    const now = yield* DateTime.now;
    return yield* Schema.encodeEffect(Schema.fromJsonString(AccountQuote))({
      binding: request.binding,
      account: node.address,
      chainId: 84532,
      proposalFingerprint: fingerprintProposal(request.proposal),
      observedAt: now,
      expiresAt: DateTime.add(now, { minutes: 5 }),
      blockNumber: yield* blockNumber,
      walletUsd: 10_000,
      resultingPositionUsd: 20,
      dailyLossUsd: 0,
      valueUsd: request.proposal.action === "launch" ? 0 : 20,
      agentLaunchesToday: 0,
      ownerLaunchesThisWeek: 0,
      allocationLockedUntil: Option.none(),
    });
  });
  const prepare = Effect.fn("RecordedSigner.prepare")(function*(request: PrepareRequest) {
    const now = yield* DateTime.now;
    const call = yield* encodeProposalCall(request.proposal);
    const latest = yield* chainCall("The isolated chain clock was unavailable", () => node.chain.getBlock());
    // Only the isolated fixture holds its fresh owner's key. A production provider must use already owner-authorized module permissions.
    const grantHash = yield* chainCall("The exact test permission was not granted", () =>
      node.owner.writeContract({
        abi: scopedAccountAbi,
        address: node.address,
        functionName: "grant",
        args: [
          permissionId,
          request.proposal.contract,
          toFunctionSelector(
            request.proposal.action === "launch"
              ? "launch(bytes32,string,string,uint256,uint256,uint256,uint256,bytes32)"
              : request.proposal.action === "withdraw"
              ? "withdrawToOwner(uint256)"
              : "buy(uint256)",
          ),
          call.value,
          latest.timestamp + 3600n,
          keccak256(call.calldata),
        ],
      }));
    yield* chainCall("Permission grant did not mine", () => node.chain.waitForTransactionReceipt({ hash: grantHash }));
    yield* chainCall("The actual scoped account simulation reverted", () =>
      node.chain.simulateContract({
        abi: scopedAccountAbi,
        address: node.address,
        functionName: "execute",
        account: node.session.account,
        args: [permissionId, request.proposal.contract, call.value, call.calldata],
      }));
    const plan = yield* Schema.decodeUnknownEffect(PreparedExecution)({
      planId: `plan:${request.receiptId}`,
      binding: request.binding,
      account: node.address,
      chainId: 84532,
      permissionId,
      receiptId: request.receiptId,
      proposalFingerprint: request.proposalFingerprint,
      target: request.proposal.contract,
      method: request.proposal.method,
      selector: call.calldata.slice(0, 10),
      calldata: call.calldata,
      nativeValue: call.value.toString(),
      asset: nativeAsset,
      assetAmount: call.value.toString(),
      recipient: request.proposal.recipient,
      amount: request.proposal.amount,
      symbol: request.proposal.symbol,
      valueUsd: request.proposal.valueUsd,
      slippageBps: request.proposal.slippageBps,
      simulated: true,
      simulatedAtBlock: yield* blockNumber,
      expiresAt: DateTime.formatIso(DateTime.min(request.approvalExpiresAt, DateTime.add(now, { minutes: 2 }))),
    });
    yield* Ref.set(prepared, Option.some(plan));
    return yield* Schema.encodeEffect(Schema.fromJsonString(PreparedExecution))(plan);
  });
  const dispatch = Effect.fn("RecordedSigner.dispatch")(function*(request: DispatchRequest) {
    const plan = yield* Effect.fromOption(yield* Ref.get(prepared));
    if (
      plan.planId !== request.planId || plan.receiptId !== request.receiptId
      || plan.proposalFingerprint !== request.proposalFingerprint
    ) {
      return yield* Effect.fail("The dispatch did not match its prepared identity.");
    }
    yield* Ref.update(dispatches, count => count + 1);
    const hash = yield* chainCall("The isolated scoped account dispatch failed", () =>
      node.session.writeContract({
        abi: scopedAccountAbi,
        address: node.address,
        functionName: "execute",
        args: [permissionId, plan.target, BigInt(plan.nativeValue), plan.calldata],
      }));
    const receipt = yield* chainCall(
      "The real dispatch receipt did not mine",
      () => node.chain.waitForTransactionReceipt({ hash }),
    );
    if (receipt.status !== "success") return yield* Effect.fail("The isolated account reverted.");
    return yield* Schema.encodeEffect(Schema.fromJsonString(DispatchResponse))({
      status: "confirmed",
      receiptId: request.receiptId,
      proposalFingerprint: request.proposalFingerprint,
      account: node.address,
      chainId: 84532,
      transactionHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber),
    });
  });
  const client = HttpClient.make(
    Effect.fn("RecordedSigner.request")(function*(request) {
      const failure = () =>
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            description: "The isolated signer conformance exchange failed.",
          }),
        });
      const route = request.url.slice("https://isolated-signer.example".length);
      yield* Ref.update(requests, current => [...current, route]);
      if (request.body._tag !== "Uint8Array") return yield* failure();
      const body = new TextDecoder().decode(request.body.body);
      const respond = Effect.gen(function*() {
        switch (route) {
          case "/v1/accounts/read":
            return yield* read(yield* Schema.decodeEffect(Schema.fromJsonString(AccountBinding))(body));
          case "/v1/accounts/quote":
            return yield* quote(yield* Schema.decodeEffect(Schema.fromJsonString(QuoteRequest))(body));
          case "/v1/transactions/prepare":
            return yield* prepare(yield* Schema.decodeEffect(Schema.fromJsonString(PrepareRequest))(body));
          case "/v1/transactions/dispatch": {
            const dispatchRequest = yield* Schema.decodeEffect(Schema.fromJsonString(DispatchRequest))(body);
            if (request.headers["idempotency-key"] !== dispatchRequest.receiptId) {
              return yield* Effect.fail("Missing idempotency key");
            }
            return yield* dispatch(dispatchRequest);
          }
          default:
            return yield* Effect.fail("Unknown signer route");
        }
      });
      const response = yield* respond.pipe(Effect.mapError(failure));
      return HttpClientResponse.fromWeb(
        request,
        new Response(response, { headers: { "content-type": "application/json" } }),
      );
    }),
  );
  return Context.make(HttpClient.HttpClient, client).pipe(Context.add(SignerTrace, { requests, dispatches }));
});

/** @stability unstable */
export const scopedSignerEdge = Layer.effectContext(makeEdge);
