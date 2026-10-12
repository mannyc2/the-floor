import { Address, Agent, defaultPolicy, type Proposal } from "@floor/contract";
import { encodeFoundryLaunch, floorFoundryAbi } from "@floor/foundry";
import { Owner } from "@floor/surfaces";
import { Context, DateTime, Effect, Schema } from "effect";
import { encodeFunctionData, parseAbi, parseEther } from "viem";
import { AnvilFlowError, bytecode, chainCall, curveAbi, openAnvil } from "./anvil";

const factoryAbi = parseAbi([
  "constructor(address treasury_, address pool_, uint256 fee_)",
  "function registerAccount(address account, address owner)",
]);
export const permissionId = `0x${"7".repeat(64)}` as const;
export const nativeAsset = "0x0000000000000000000000000000000000000000";
/** @stability unstable */
export const makeFinancialChain = Effect.gen(function*() {
  const node = yield* openAnvil();
  const deploy = Effect.fn("FinancialFlow.deploy")(function*(hash: `0x${string}`) {
    const receipt = yield* chainCall(
      "Contract deployment did not mine",
      () => node.chain.waitForTransactionReceipt({ hash }),
    );
    return yield* Schema.decodeUnknownEffect(Address)(receipt.contractAddress);
  });
  const poolCode = yield* bytecode("Foundry.t.sol/Pool");
  const pool = yield* deploy(
    yield* chainCall("Pool deployment failed", () => node.owner.deployContract({ abi: [], bytecode: poolCode })),
  );
  const factoryCode = yield* bytecode("FloorFoundry.sol/FloorFoundry");
  const factory = yield* deploy(
    yield* chainCall("Foundry deployment failed", () =>
      node.owner.deployContract({
        abi: factoryAbi,
        bytecode: factoryCode,
        args: [node.owner.account.address, pool, 0n],
      })),
  );
  for (const account of [node.address, node.owner.account.address]) {
    const hash = yield* chainCall("Account registration failed", () =>
      node.owner.writeContract({
        abi: factoryAbi,
        address: factory,
        functionName: "registerAccount",
        args: [account, node.owner.account.address],
      }));
    yield* chainCall("Registration did not mine", () => node.chain.waitForTransactionReceipt({ hash }));
  }
  const bootstrap = {
    launchId: `0x${"1".repeat(64)}` as const,
    name: "Flow Tide",
    symbol: "TIDE",
    supply: "1000000",
    allocation: "0",
    graduationThresholdWei: parseEther("1").toString(),
    virtualLiquidityWei: parseEther("1").toString(),
    launchFeeWei: "0",
    thesisHash: `0x${"2".repeat(64)}` as const,
  };
  const encoded = yield* encodeFoundryLaunch(bootstrap);
  const launchHash = yield* chainCall(
    "Bootstrap market launch failed",
    () => node.owner.sendTransaction({ to: factory, data: encoded.calldata, value: encoded.value }),
  );
  yield* chainCall("Bootstrap launch did not mine", () => node.chain.waitForTransactionReceipt({ hash: launchHash }));
  const curve = yield* chainCall("Bootstrap curve unavailable", () =>
    node.chain.readContract({
      abi: floorFoundryAbi,
      address: factory,
      functionName: "launches",
      args: [bootstrap.launchId],
    }));
  const token = yield* chainCall(
    "Bootstrap token unavailable",
    () => node.chain.readContract({ abi: curveAbi, address: curve, functionName: "token" }),
  );
  const now = DateTime.formatIso(yield* DateTime.now);
  const owner = Owner.make({ id: "financial-owner", walletAddress: node.owner.account.address, mode: "wallet" });
  const agent = Agent.make({
    id: "financial-agent",
    owner: owner.id,
    name: "Tide Reader",
    emblem: { shape: "circle", modifier: "dot" },
    walletAddress: node.address,
    mandate: "Use sourced evidence and only the owner's confirmed limits.",
    policy: {
      ...defaultPolicy,
      allowedContracts: [curve, factory],
      allowedMethods: ["buy", "launch"],
      allowedProtocols: ["floor-curve", "floor-foundry"],
      launchAllowed: true,
      confirmedAt: now,
    },
    visibility: "public",
    publishMandate: false,
    paused: false,
    state: "deciding",
    budget: { dailyUsd: 10, spentUsd: 0, day: now.slice(0, 10) },
    districtId: "base-harbour",
    createdAt: now,
  });
  const proposal = {
    id: "financial-trade",
    owner: owner.id,
    agentId: agent.id,
    action: "trade",
    chainId: 84532,
    protocol: "floor-curve",
    contract: curve,
    method: "buy",
    recipient: node.address,
    marketId: "financial-market",
    amount: "0.001",
    symbol: "ETH",
    valueUsd: 20,
    slippageBps: 20,
    thesisId: "financial-thesis",
    sourceIds: ["financial-source"],
    createdAt: now,
  } satisfies Proposal;
  const launch = {
    ...proposal,
    action: "launch",
    id: "financial-launch",
    protocol: "floor-foundry",
    contract: factory,
    method: "launch",
    amount: "100000",
    symbol: "CAST",
    valueUsd: 0,
    launch: {
      ...bootstrap,
      launchId: `0x${"3".repeat(64)}`,
      name: "Sourced Cast",
      symbol: "CAST",
      allocation: "100000",
    },
  } satisfies Proposal;
  return { ...node, ownerIdentity: owner, agent, proposal, launch, curve, token, pool, factory };
});
export class FinancialChain
  extends Context.Service<FinancialChain, Effect.Success<typeof makeFinancialChain>>()("flow/FinancialChain")
{}

export const encodeProposalCall = Effect.fn("FinancialFlow.encodeCall")(function*(proposal: Proposal) {
  if (proposal.action === "launch") return yield* encodeFoundryLaunch(proposal.launch);
  if (proposal.action === "withdraw") {
    return {
      calldata: encodeFunctionData({
        abi: parseAbi(["function withdrawToOwner(uint256 amount)"]),
        functionName: "withdrawToOwner",
        args: [parseEther(proposal.amount)],
      }),
      value: 0n,
    };
  }
  if (proposal.method !== "buy") {
    return yield* new AnvilFlowError({ message: "The local fixture only implements its documented curve buy." });
  }
  return {
    calldata: encodeFunctionData({ abi: curveAbi, functionName: "buy", args: [1n] }),
    value: parseEther(proposal.amount),
  };
});
