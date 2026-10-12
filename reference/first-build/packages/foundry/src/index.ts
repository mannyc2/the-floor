import { Address, FoundryLaunchSpec, type Policy, type Proposal, TokenAmount } from "@floor/contract";
import { BigDecimal, Effect, Option, Result, Schema } from "effect";
import { encodeFunctionData, formatUnits, parseAbi } from "viem";
export const LaunchRequest = Schema.Struct({
  id: Schema.NonEmptyString,
  agentId: Schema.String,
  owner: Schema.String,
  ...FoundryLaunchSpec.fields,
  thesisId: Schema.NonEmptyString,
  sourceIds: Schema.Array(Schema.String),
  budgetUsd: Schema.Finite,
  chainId: Schema.Int,
  contract: Address,
});
export type LaunchRequest = typeof LaunchRequest.Type;
export class LaunchDenied extends Schema.TaggedError<LaunchDenied>()("LaunchDenied", { message: Schema.String }) {}
export interface LaunchRecord {
  readonly id: string;
  readonly agentId: string;
  readonly owner: string;
  readonly tokenAddress: Option.Option<string>;
  readonly name: string;
  readonly symbol: string;
  readonly thesisId: string;
  readonly allocation: string;
  readonly unlockAt: string;
  readonly state: "proposed" | "casting" | "active" | "graduated" | "failed";
  readonly transactionHash: Option.Option<string>;
  readonly createdAt: string;
}
function tokenAtoms(amount: string): Result.Result<bigint, LaunchDenied> {
  const parsed = Schema.decodeResult(TokenAmount)(amount);
  if (Result.isFailure(parsed)) {
    return Result.fail(new LaunchDenied({ message: "Token quantities need at most 18 decimal places" }));
  }
  const decimal = BigDecimal.fromString(parsed.success);
  if (Option.isNone(decimal)) return Result.fail(new LaunchDenied({ message: "Invalid exact token amount" }));
  const value = BigDecimal.scale(decimal.value, 18).value;
  return value < 2n ** 256n
    ? Result.succeed(value)
    : Result.fail(new LaunchDenied({ message: "Token quantity exceeds the contract integer range" }));
}
export function allocationFromPercent(supply: string, percent: number): Result.Result<string, LaunchDenied> {
  const atoms = tokenAtoms(supply);
  if (Result.isFailure(atoms)) return Result.fail(atoms.failure);
  const percentage = BigDecimal.fromNumber(percent);
  if (Option.isNone(percentage) || percent < 0 || percent >= 100) {
    return Result.fail(new LaunchDenied({ message: "Allocation must be at least zero and below 100 percent." }));
  }
  // Round toward zero at the token's smallest unit so a percentage can never over-allocate the declared supply.
  const fraction = BigDecimal.make(percentage.value.value, percentage.value.scale + 2);
  const allocation = BigDecimal.scale(BigDecimal.multiply(BigDecimal.fromBigInt(atoms.success), fraction), 0).value;
  return Result.succeed(formatUnits(allocation, 18));
}
function validateLaunch(launch: LaunchRequest, policy: Policy): Result.Result<LaunchRequest, LaunchDenied> {
  if (launch.chainId !== 84532 && launch.chainId !== 31337) {
    return Result.fail(new LaunchDenied({ message: "Foundry launches are testnet only" }));
  }
  if (!policy.launchAllowed || launch.budgetUsd > policy.launchBudgetUsd || launch.budgetUsd < 0) {
    return Result.fail(new LaunchDenied({ message: "Launch permission and budget required" }));
  }
  if (launch.sourceIds.length === 0) {
    return Result.fail(new LaunchDenied({ message: "Launch thesis must cite its sources" }));
  }
  if (launch.name.length > 64 || !/^[A-Za-z0-9]{1,12}$/.test(launch.symbol)) {
    return Result.fail(new LaunchDenied({ message: "Name maximum 64 characters; symbol 1–12 letters or digits" }));
  }
  const supply = tokenAtoms(launch.supply);
  const allocation = tokenAtoms(launch.allocation);
  if (Result.isFailure(supply)) return Result.fail(supply.failure);
  if (Result.isFailure(allocation)) return Result.fail(allocation.failure);
  if (supply.success <= 0n || allocation.success >= supply.success) {
    return Result.fail(
      new LaunchDenied({ message: "Launching allocation must leave a positive supply for the curve" }),
    );
  }
  if (
    BigInt(launch.graduationThresholdWei) <= 0n || BigInt(launch.virtualLiquidityWei) <= 0n
    || [launch.graduationThresholdWei, launch.virtualLiquidityWei, launch.launchFeeWei].some((amount) =>
      BigInt(amount) >= 2n ** 256n
    )
  ) {
    return Result.fail(
      new LaunchDenied({
        message: "Curve parameters must fit uint256 and retain positive graduation and virtual liquidity.",
      }),
    );
  }
  return Result.succeed(launch);
}
export function launchProposal(
  input: LaunchRequest,
  policy: Policy,
  accountAddress: string,
  now: string,
): Result.Result<Proposal, LaunchDenied> {
  const parsed = Schema.decodeResult(LaunchRequest)(input);
  if (Result.isFailure(parsed)) {
    return Result.fail(new LaunchDenied({ message: "The launch parameters are malformed." }));
  }
  const validated = validateLaunch(parsed.success, policy);
  if (Result.isFailure(validated)) return Result.fail(validated.failure);
  const recipient = Schema.decodeUnknownResult(Address)(accountAddress);
  if (Result.isFailure(recipient)) return Result.fail(new LaunchDenied({ message: recipient.failure.message }));
  const launch = validated.success;
  return Result.succeed({
    id: launch.id,
    agentId: launch.agentId,
    owner: launch.owner,
    action: "launch",
    launch: {
      launchId: launch.launchId,
      name: launch.name,
      symbol: launch.symbol,
      supply: launch.supply,
      allocation: launch.allocation,
      graduationThresholdWei: launch.graduationThresholdWei,
      virtualLiquidityWei: launch.virtualLiquidityWei,
      launchFeeWei: launch.launchFeeWei,
      thesisHash: launch.thesisHash,
    },
    chainId: launch.chainId,
    protocol: "floor-foundry",
    contract: launch.contract,
    method: "launch",
    recipient: recipient.success,
    marketId: `launch:${launch.id}`,
    amount: launch.allocation,
    symbol: launch.symbol,
    valueUsd: launch.budgetUsd,
    slippageBps: 0,
    thesisId: launch.thesisId,
    sourceIds: launch.sourceIds,
    createdAt: now,
  });
}
export const floorFoundryAbi = parseAbi([
  "function launch(bytes32 id, string name, string symbol, uint256 supply, uint256 allocation, uint256 threshold, uint256 virtualEth, bytes32 thesis) payable returns (address)",
  "function registerAccount(address account, address owner)",
  "function launches(bytes32 id) view returns (address)",
]);

export const encodeFoundryLaunch = Effect.fn("Foundry.encodeLaunch")(function*(spec: FoundryLaunchSpec) {
  const checked = yield* Schema.decodeEffect(FoundryLaunchSpec)(spec).pipe(
    Effect.mapError(() => new LaunchDenied({ message: "Invalid canonical launch parameters" })),
  );
  const supply = yield* Effect.fromResult(tokenAtoms(checked.supply));
  const allocation = yield* Effect.fromResult(tokenAtoms(checked.allocation));
  return yield* Effect.try({
    try: () => ({
      calldata: encodeFunctionData({
        abi: floorFoundryAbi,
        functionName: "launch",
        args: [
          checked.launchId,
          checked.name,
          checked.symbol,
          supply,
          allocation,
          BigInt(checked.graduationThresholdWei),
          BigInt(checked.virtualLiquidityWei),
          checked.thesisHash,
        ],
      }),
      value: BigInt(checked.launchFeeWei),
    }),
    catch: () =>
      new LaunchDenied({ message: "The launch parameters could not be encoded for the immutable foundry contract." }),
  });
});
export function allocationCanTransfer(
  balance: bigint,
  transfer: bigint,
  lockedAllocation: bigint,
  unlockAt: number,
  now: number,
): boolean {
  return transfer >= 0n && transfer <= balance && (now >= unlockAt || balance - transfer >= lockedAllocation);
}
export function curveBuy(
  tokenReserve: bigint,
  virtualEthReserve: bigint,
  ethIn: bigint,
): Result.Result<bigint, LaunchDenied> {
  if (tokenReserve <= 0n || virtualEthReserve <= 0n || ethIn <= 0n) {
    return Result.fail(new LaunchDenied({ message: "Positive reserves and input required" }));
  }
  return Result.succeed(tokenReserve * ethIn / (virtualEthReserve + ethIn));
}
export function curveSell(
  tokenReserve: bigint,
  virtualEthReserve: bigint,
  tokensIn: bigint,
): Result.Result<bigint, LaunchDenied> {
  if (tokenReserve <= 0n || virtualEthReserve <= 0n || tokensIn <= 0n) {
    return Result.fail(new LaunchDenied({ message: "Positive reserves and input required" }));
  }
  return Result.succeed(virtualEthReserve * tokensIn / (tokenReserve + tokensIn));
}
export interface PlinthProposal {
  readonly id: string;
  readonly tokenId: string;
  readonly proposer: string;
  readonly createdAt: string;
  readonly votes: readonly { readonly voter: string; readonly balanceAtSnapshot: bigint; readonly support: boolean }[];
  readonly snapshotSupply: bigint;
}
export type VoteOutcome = "open" | "adopted" | "rejected";
export function voteResult(proposal: PlinthProposal, now: string): Result.Result<VoteOutcome, LaunchDenied> {
  if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(proposal.createdAt))) {
    return Result.fail(new LaunchDenied({ message: "Vote timestamps must be valid" }));
  }
  if (Date.parse(now) < Date.parse(proposal.createdAt) + 72 * 3600000) return Result.succeed("open");
  const voters = new Set<string>();
  let yes = 0n;
  let no = 0n;
  for (const vote of proposal.votes) {
    if (voters.has(vote.voter.toLowerCase()) || vote.balanceAtSnapshot < 0n) {
      return Result.fail(new LaunchDenied({ message: "One snapshot-verified vote per holder" }));
    }
    voters.add(vote.voter.toLowerCase());
    if (vote.support) yes += vote.balanceAtSnapshot;
    else no += vote.balanceAtSnapshot;
  }
  return Result.succeed(
    proposal.snapshotSupply > 0n && (yes + no) * 100n >= proposal.snapshotSupply && yes > no ? "adopted" : "rejected",
  );
}
