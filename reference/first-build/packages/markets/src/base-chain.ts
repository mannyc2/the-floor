import {
  Array,
  Cache,
  Config,
  Context,
  Data,
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Result,
  Schedule,
  Schema,
} from "effect";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, parseAbi, parseAbiItem } from "viem";
import { base } from "viem/chains";
import {
  InvalidPoolReading,
  normalizeBondingCurve,
  normalizeConcentratedLiquidity,
  normalizeConstantProduct,
} from "./normalizers";
import { BASE_POOLS } from "./pools";
import {
  emptyMarket,
  enrichMarket,
  type MarketSnapshot,
  type MarketView,
  type PoolConfig,
  type Provenance,
} from "./types";
import { virtualBondingAbi, virtualPairAbi, virtualSwap } from "./virtuals";

const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function stable() view returns (bool)",
]);
const swapV2 = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
);
const swapV3 = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const stamp = (seconds: bigint) => DateTime.formatIso(DateTime.makeUnsafe(Number(seconds) * 1000));
export class MarketRpcError
  extends Schema.TaggedError<MarketRpcError>()("MarketRpcError", { message: Schema.String })
{}
export interface BaseChainOptions {
  readonly rpcUrl?: string;
  readonly logRpcUrl?: string;
  readonly pools?: readonly PoolConfig[];
}
export class BaseChain extends Context.Service<BaseChain, {
  readonly readAtBlock: (block?: number) => Effect.Effect<MarketSnapshot, MarketRpcError>;
  readonly rpcHost: string;
}>()("floor/BaseChain") {
  static readonly layer = (options: BaseChainOptions = {}) => Layer.effect(BaseChain, makeBaseChain(options));
}
const rpc = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: () => new MarketRpcError({ message: "Base RPC request failed" }) }).pipe(
    Effect.retry({ schedule: Schedule.exponential("200 millis"), times: 1 }),
  );
class TokenAtBlock extends Data.Class<{ readonly address: `0x${string}`; readonly blockNumber: bigint }> {}
interface FlowLog {
  readonly address: string;
  readonly amount0: bigint;
  readonly amount1: bigint;
}
const aggregateFlows = (
  markets: readonly MarketView[],
  windows: readonly {
    readonly kind: MarketView["kind"];
    readonly logs: Result.Result<readonly FlowLog[], MarketRpcError>;
  }[],
) => {
  const flows = new Map<string, { trades: number; quoteVolume: number }>();
  const measuredKinds = new Set<MarketView["kind"]>();
  for (const window of windows) {
    if (Result.isFailure(window.logs)) continue;
    measuredKinds.add(window.kind);
    for (const log of window.logs.success) {
      const market = markets.find(candidate => candidate.address.toLowerCase() === log.address.toLowerCase());
      if (!market) continue;
      const raw = market.quote.address === market.token0.address ? log.amount0 : log.amount1;
      const previous = flows.get(market.id) ?? { trades: 0, quoteVolume: 0 };
      flows.set(market.id, {
        trades: previous.trades + 1,
        quoteVolume: previous.quoteVolume + Number(formatUnits(raw < 0n ? -raw : raw, market.quote.decimals)),
      });
    }
  }
  return { flows, measuredKinds };
};
const makeBaseChain = (options: BaseChainOptions) =>
  Effect.gen(function*() {
    const configuredRpc = yield* Config.String("BASE_RPC_URL").pipe(Config.withDefault("https://mainnet.base.org"));
    const configuredLogs = yield* Config.String("BASE_LOG_RPC_URL").pipe(
      Config.withDefault("https://base-rpc.publicnode.com"),
    );
    const rpcUrl = options.rpcUrl ?? configuredRpc;
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl, { timeout: 12_000, retryCount: 0 }),
      batch: { multicall: { wait: 25, batchSize: 8192 } },
    });
    const logClient = createPublicClient({
      chain: base,
      transport: http(options.logRpcUrl ?? options.rpcUrl ?? configuredLogs, { timeout: 12_000, retryCount: 0 }),
    });
    const pools = options.pools ?? BASE_POOLS;
    const tokens = yield* Cache.makeWith(
      Effect.fn("Markets.readToken")(function*(key: TokenAtBlock) {
        const { address, blockNumber } = key;
        const [symbol, name, decimals] = yield* Effect.all([
          rpc(() => client.readContract({ address, abi: erc20Abi, functionName: "symbol", blockNumber })),
          rpc(() => client.readContract({ address, abi: erc20Abi, functionName: "name", blockNumber })),
          rpc(() => client.readContract({ address, abi: erc20Abi, functionName: "decimals", blockNumber })),
        ], { concurrency: 3 });
        const token = { address: getAddress(address), symbol, name, decimals };
        return token;
      }),
      { capacity: 2048, timeToLive: exit => Exit.isSuccess(exit) ? "1 hour" : "0 seconds" },
    );
    const readToken = (address: `0x${string}`, blockNumber: bigint) =>
      Cache.get(tokens, new TokenAtBlock({ address: getAddress(address.toLowerCase()), blockNumber }));
    const readCurve = Effect.fn("BaseChain.readVirtualsCurve")(
      function*(pool: Extract<PoolConfig, { readonly kind: "bonding-curve" }>, provenance: Provenance) {
        const address = getAddress(pool.address.toLowerCase());
        const blockNumber = BigInt(provenance.blockNumber);
        const [address0, address1, virtualReserves, reserve0, reserve1, remainingThreshold, info, supply] =
          yield* Effect.all([
            rpc(() => client.readContract({ address, abi: virtualPairAbi, functionName: "tokenA", blockNumber })),
            rpc(() => client.readContract({ address, abi: virtualPairAbi, functionName: "tokenB", blockNumber })),
            rpc(() => client.readContract({ address, abi: virtualPairAbi, functionName: "getReserves", blockNumber })),
            rpc(() => client.readContract({ address, abi: virtualPairAbi, functionName: "balance", blockNumber })),
            rpc(() => client.readContract({ address, abi: virtualPairAbi, functionName: "assetBalance", blockNumber })),
            rpc(() =>
              client.readContract({
                address: pool.bonding,
                abi: virtualBondingAbi,
                functionName: "gradThreshold",
                blockNumber,
              })
            ),
            rpc(() =>
              client.readContract({
                address: pool.bonding,
                abi: virtualBondingAbi,
                functionName: "tokenInfo",
                args: [pool.token],
                blockNumber,
              })
            ),
            rpc(() =>
              client.readContract({ address: pool.token, abi: erc20Abi, functionName: "totalSupply", blockNumber })
            ),
          ], { concurrency: 4 });
        if (
          address0.toLowerCase() !== pool.token.toLowerCase() || info[1].toLowerCase() !== pool.token.toLowerCase()
          || info[2].toLowerCase() !== address.toLowerCase()
        ) {
          return yield* new InvalidPoolReading({
            message: "Curve does not match the protocol's canonical token registry",
          });
        }
        const [token, quote] = yield* Effect.all([readToken(address0, blockNumber), readToken(address1, blockNumber)], {
          concurrency: 2,
        });
        const reading = yield* normalizeBondingCurve({
          token0: token,
          token1: quote,
          baseAddress: token.address,
          reserve0,
          reserve1,
          provenance,
          virtualTokenReserve: virtualReserves[0],
          virtualQuoteReserve: virtualReserves[1],
          supply,
          graduation: { basis: "tokens-sold", remainingThreshold, initialSupply: info[4].supply },
          graduated: info[12],
        });
        return emptyMarket(pool, address, token, quote, token, quote, reading);
      },
    );
    const readPool = Effect.fn("Markets.readPool")(function*(pool: PoolConfig, provenance: Provenance) {
      if (pool.kind === "bonding-curve") return yield* readCurve(pool, provenance);
      const address = getAddress(pool.address.toLowerCase());
      const blockNumber = BigInt(provenance.blockNumber);
      const [address0, address1] = yield* Effect.all([
        rpc(() => client.readContract({ address, abi: poolAbi, functionName: "token0", blockNumber })),
        rpc(() => client.readContract({ address, abi: poolAbi, functionName: "token1", blockNumber })),
      ], { concurrency: 2 });
      const [token0, token1] = yield* Effect.all([readToken(address0, blockNumber), readToken(address1, blockNumber)], {
        concurrency: 2,
      });
      const quote = [token1, token0].find(token => token.address.toLowerCase() === USDC)
        ?? [token1, token0].find(token => token.address.toLowerCase() === WETH) ?? token1;
      const token = quote.address === token1.address ? token0 : token1;
      if (pool.kind === "constant-product") {
        if (
          pool.stableCheck === true
          && (yield* rpc(() => client.readContract({ address, abi: poolAbi, functionName: "stable", blockNumber })))
        ) return yield* new InvalidPoolReading({ message: "Stable pool needs a stable-swap normalizer" });
        const [reserve0, reserve1] = yield* rpc(() =>
          client.readContract({ address, abi: poolAbi, functionName: "getReserves", blockNumber })
        );
        const reading = yield* normalizeConstantProduct({
          token0,
          token1,
          baseAddress: token.address,
          reserve0,
          reserve1,
          provenance,
        });
        return emptyMarket(pool, address, token, quote, token0, token1, reading);
      }
      const [slot, liquidity, spacing, reserve0, reserve1] = yield* Effect.all([
        rpc(() => client.readContract({ address, abi: poolAbi, functionName: "slot0", blockNumber })),
        rpc(() => client.readContract({ address, abi: poolAbi, functionName: "liquidity", blockNumber })),
        rpc(() => client.readContract({ address, abi: poolAbi, functionName: "tickSpacing", blockNumber })),
        rpc(() =>
          client.readContract({
            address: address0,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
            blockNumber,
          })
        ),
        rpc(() =>
          client.readContract({
            address: address1,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
            blockNumber,
          })
        ),
      ], { concurrency: 5 });
      const tickLower = Math.floor(slot[1] / spacing) * spacing;
      // Only the observed active interval is exposed; unqueried pool depth remains absent.
      const reading = yield* normalizeConcentratedLiquidity({
        token0,
        token1,
        baseAddress: token.address,
        reserve0,
        reserve1,
        provenance,
        sqrtPriceX96: slot[0],
        tick: slot[1],
        liquidity,
        bands: [{ tickLower, tickUpper: tickLower + spacing, liquidity: liquidity.toString(), active: true }],
      });
      return emptyMarket(pool, address, token, quote, token0, token1, reading);
    });
    const readFlows = Effect.fn("BaseChain.readFlows")(function*(markets: readonly MarketView[], blockNumber: bigint) {
      const fromBlock = blockNumber > 60n ? blockNumber - 60n : 0n;
      const addresses = (kind: MarketView["kind"]) =>
        Array.filterMap(markets, market =>
          market.kind === kind ? Result.succeed(getAddress(market.address)) : Result.failVoid);
      const constantProduct = addresses("constant-product");
      const concentrated = addresses("concentrated-liquidity");
      const bonding = addresses("bonding-curve");
      const [v2, v3, curves] = yield* Effect.all([
        Effect.result(
          constantProduct.length === 0
            ? Effect.succeed<readonly FlowLog[]>([])
            : rpc(() =>
              logClient.getLogs({
                strict: true,
                event: swapV2,
                address: constantProduct,
                fromBlock,
                toBlock: blockNumber,
              })
            ).pipe(
              Effect.map(logs =>
                logs.map(log => ({
                  address: log.address,
                  amount0: log.args.amount0In + log.args.amount0Out,
                  amount1: log.args.amount1In + log.args.amount1Out,
                }))
              ),
            ),
        ),
        Effect.result(
          concentrated.length === 0
            ? Effect.succeed<readonly FlowLog[]>([])
            : rpc(() =>
              logClient.getLogs({ strict: true, event: swapV3, address: concentrated, fromBlock, toBlock: blockNumber })
            ).pipe(
              Effect.map(logs =>
                logs.map(log => ({ address: log.address, amount0: log.args.amount0, amount1: log.args.amount1 }))
              ),
            ),
        ),
        Effect.result(
          bonding.length === 0
            ? Effect.succeed<readonly FlowLog[]>([])
            : rpc(() =>
              logClient.getLogs({ strict: true, event: virtualSwap, address: bonding, fromBlock, toBlock: blockNumber })
            ).pipe(
              Effect.map(logs =>
                logs.map(log => ({
                  address: log.address,
                  amount0: log.args.amount0In + log.args.amount0Out,
                  amount1: log.args.amount1In + log.args.amount1Out,
                }))
              ),
            ),
        ),
      ], { concurrency: 3 });
      return {
        ...aggregateFlows(markets, [
          { kind: "constant-product", logs: v2 },
          { kind: "concentrated-liquidity", logs: v3 },
          { kind: "bonding-curve", logs: curves },
        ]),
        fromBlock,
      };
    });
    const readAtBlock = Effect.fn("BaseChain.readAtBlock")(function*(at?: number) {
      const block = yield* rpc(() =>
        client.getBlock(
          Option.match(Option.fromUndefinedOr(at), {
            onNone: () => ({ blockTag: "latest" as const }),
            onSome: blockNumber => ({ blockNumber: BigInt(blockNumber) }),
          }),
        )
      );
      const provenance: Provenance = {
        chainId: 8453,
        blockNumber: Number(block.number),
        blockHash: block.hash,
        blockTimestamp: stamp(block.timestamp),
        observedAt: DateTime.formatIso(yield* DateTime.now),
        source: "chain",
      };
      const results = yield* Effect.forEach(pools, pool =>
        Effect.result(readPool(pool, provenance)), {
        concurrency: 4,
      });
      const markets = Array.getSuccesses(results);
      if (markets.length === 0) {
        return yield* new MarketRpcError({ message: "Base RPC returned no supported pool readings" });
      }
      const { flows, measuredKinds, fromBlock } = yield* readFlows(markets, block.number);
      // Dollar marks are derived only from another pool in this same pinned block, never from discovery API prices.
      const dollarQuotes = new Map(
        markets.filter(market => market.quote.address.toLowerCase() === USDC).map(market =>
          [market.token.address.toLowerCase(), market.reading.price] as const
        ),
      );
      dollarQuotes.set(USDC, 1);
      const enriched = markets.map(market => {
        const quoteUsd = Option.fromUndefinedOr(dollarQuotes.get(market.quote.address.toLowerCase()));
        const measured = flows.get(market.id) ?? { trades: 0, quoteVolume: 0 };
        const flow = measuredKinds.has(market.kind)
          ? Option.some({
            ...measured,
            windowSeconds: Number(block.number - fromBlock + 1n) * 2,
            fromBlock: Number(fromBlock),
            toBlock: Number(block.number),
          })
          : Option.none();
        return enrichMarket(market, quoteUsd, [], Option.none(), flow);
      });
      // Recheck the pinned header because number-based calls may otherwise combine two sides of a reorganization.
      const verifiedBlock = yield* rpc(() => client.getBlock({ blockNumber: block.number }));
      if (verifiedBlock.hash !== block.hash) {
        return yield* new MarketRpcError({ message: "Base block changed during market collection" });
      }
      const snapshot: MarketSnapshot = {
        ...provenance,
        markets: enriched,
        status: {
          mode: "live",
          message: `Read ${markets.length} Base pools at block ${provenance.blockNumber}${
            markets.length < pools.length ? `; ${pools.length - markets.length} unavailable` : ""
          }.`,
        },
      };
      return snapshot;
    });
    return BaseChain.of({ readAtBlock, rpcHost: new URL(rpcUrl).hostname });
  });
