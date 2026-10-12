import { Address, TransactionHash } from "@floor/contract";
import { Config, Context, Effect, Layer, Schema, Semaphore } from "effect";
import { createPublicClient, erc20Abi, http } from "viem";
import { base } from "viem/chains";

export const HolderRequest = Schema.Struct({
  token: Address,
  wallet: Address,
  blockNumber: Schema.Int,
  blockHash: TransactionHash,
});
export type HolderRequest = typeof HolderRequest.Type;
export class HolderEvidenceError extends Schema.TaggedError<HolderEvidenceError>()("HolderEvidenceError", {
  message: Schema.String,
}) {}
const rpc = <A>(request: () => Promise<A>) =>
  Effect.tryPromise({
    try: request,
    catch: () =>
      new HolderEvidenceError({ message: "Holder balances could not be verified at the voting source block." }),
  });
export class TokenHolders extends Context.Service<TokenHolders, {
  at(request: HolderRequest): Effect.Effect<{ readonly balance: bigint; readonly supply: bigint }, HolderEvidenceError>;
}>()("floor/TokenHolders") {
  static readonly unavailable = Layer.succeed(
    TokenHolders,
    TokenHolders.of({
      at: () => Effect.fail(new HolderEvidenceError({ message: "Verified holder balances are unavailable." })),
    }),
  );
  static readonly layer = Layer.effect(
    TokenHolders,
    Effect.gen(function*() {
      const url = yield* Config.URL("BASE_RPC_URL").pipe(Config.withDefault(new URL("https://mainnet.base.org")));
      const client = createPublicClient({
        chain: base,
        transport: http(url.toString(), { timeout: 8000, retryCount: 0 }),
      });
      const capacity = yield* Semaphore.make(4);
      return TokenHolders.of({
        at: Effect.fn("TokenHolders.at")(function*(request) {
          if ((yield* rpc(() => client.getChainId())) !== 8453) {
            return yield* new HolderEvidenceError({
              message: "Community voting requires the Base mainnet source chain.",
            });
          }
          const blockNumber = BigInt(request.blockNumber);
          const before = yield* rpc(() => client.getBlock({ blockNumber }));
          const [balance, supply] = yield* Effect.all([
            rpc(() =>
              client.readContract({
                address: request.token,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [request.wallet],
                blockNumber,
              })
            ),
            rpc(() =>
              client.readContract({ address: request.token, abi: erc20Abi, functionName: "totalSupply", blockNumber })
            ),
          ], { concurrency: 2 });
          const after = yield* rpc(() => client.getBlock({ blockNumber }));
          // Freezing both the block number and hash stops transfers, duplicate sessions and reorgs from changing voting weight.
          if (
            before.hash !== request.blockHash || after.hash !== request.blockHash || supply <= 0n || balance > supply
          ) {
            return yield* new HolderEvidenceError({
              message: "The voting block or token supply no longer matches its verified source.",
            });
          }
          return { balance, supply };
        }, capacity.withPermits(1)),
      });
    }),
  );
}
