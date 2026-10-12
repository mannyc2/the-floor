import { assert, it } from "@effect/vitest";
import { floorFoundryAbi } from "@floor/foundry";
import { Effect, Result } from "effect";
import { encodeFunctionData, parseAbi, parseEther } from "viem";
import { Proposals } from "../../packages/server/src/proposals";
import { chainCall, curveAbi, scopedAccountAbi, tokenAbi } from "./_fixtures/anvil";
import { FinancialChain } from "./_fixtures/financial-chain";
import { financialFloor, insertFinancialEvidence } from "./_fixtures/financial-floor";

const allocationLockProof = Effect.fn("LaunchFlow.allocationLock")(
  function*(curve: `0x${string}`, token: `0x${string}`) {
    const node = yield* FinancialChain;
    const directCall = (target: `0x${string}`, data: `0x${string}`) =>
      node.chain.simulateContract({
        abi: scopedAccountAbi,
        address: node.address,
        account: node.owner.account,
        functionName: "ownerCall",
        args: [target, 0n, data],
      });
    const transfer = encodeFunctionData({
      abi: tokenAbi,
      functionName: "transfer",
      args: [node.buyer.account.address, 1n],
    });
    assert.isTrue(Result.isFailure(
      yield* chainCall("Locked direct transfer", () => directCall(token, transfer)).pipe(Effect.result),
    ));
    const approval = encodeFunctionData({
      abi: tokenAbi,
      functionName: "approve",
      args: [node.buyer.account.address, parseEther("100000")],
    });
    const hash = yield* chainCall("Owner allowance failed", () =>
      node.owner.writeContract({
        abi: scopedAccountAbi,
        address: node.address,
        functionName: "ownerCall",
        args: [token, 0n, approval],
      }));
    yield* chainCall("Allowance was not mined", () => node.chain.waitForTransactionReceipt({ hash }));
    assert.isTrue(Result.isFailure(
      yield* chainCall("Locked transferFrom", () =>
        node.chain.simulateContract({
          abi: tokenAbi,
          address: token,
          account: node.buyer.account,
          functionName: "transferFrom",
          args: [node.address, node.buyer.account.address, 1n],
        })).pipe(Effect.result),
    ));
    const purchase = yield* chainCall("Buyer could not establish a curve reserve", () =>
      node.buyer.writeContract({
        abi: curveAbi,
        address: curve,
        functionName: "buy",
        args: [1n],
        value: parseEther("1"),
      }));
    yield* chainCall("Purchase did not mine", () => node.chain.waitForTransactionReceipt({ hash: purchase }));
    const curveApproval = encodeFunctionData({
      abi: tokenAbi,
      functionName: "approve",
      args: [curve, parseEther("100")],
    });
    const approvedCurve = yield* chainCall("Curve allowance failed", () =>
      node.owner.writeContract({
        abi: scopedAccountAbi,
        address: node.address,
        functionName: "ownerCall",
        args: [token, 0n, curveApproval],
      }));
    yield* chainCall(
      "Curve allowance was not mined",
      () => node.chain.waitForTransactionReceipt({ hash: approvedCurve }),
    );
    const sell = encodeFunctionData({ abi: curveAbi, functionName: "sell", args: [parseEther("100"), 0n] });
    assert.isTrue(Result.isFailure(
      yield* chainCall("Locked direct sale", () => directCall(curve, sell)).pipe(Effect.result),
    ));
    const unlockAt = yield* chainCall(
      "Allocation unlock time unavailable",
      () => node.chain.readContract({ abi: tokenAbi, address: token, functionName: "unlockAt" }),
    );
    yield* chainCall(
      "Isolated chain time could not advance",
      () => node.control.setNextBlockTimestamp({ timestamp: unlockAt }),
    );
    yield* chainCall("Unlock block was not mined", () => node.control.mine({ blocks: 1 }));
    const unlocked = yield* chainCall("Allocation remained locked after seven days", () =>
      node.owner.writeContract({
        abi: scopedAccountAbi,
        address: node.address,
        functionName: "ownerCall",
        args: [token, 0n, transfer],
      }));
    const unlockReceipt = yield* chainCall(
      "Unlocked transfer did not mine",
      () => node.chain.waitForTransactionReceipt({ hash: unlocked }),
    );
    assert.strictEqual(unlockReceipt.status, "success");
  },
);

const graduationProof = Effect.fn("LaunchFlow.graduation")(function*(curve: `0x${string}`, token: `0x${string}`) {
  const node = yield* FinancialChain;
  const hash = yield* chainCall(
    "Curve could not graduate",
    () => node.buyer.writeContract({ abi: curveAbi, address: curve, functionName: "graduate" }),
  );
  yield* chainCall("Graduation did not mine", () => node.chain.waitForTransactionReceipt({ hash }));
  assert.isTrue(
    yield* chainCall(
      "Graduation state unavailable",
      () => node.chain.readContract({ abi: curveAbi, address: curve, functionName: "graduated" }),
    ),
  );
  assert.strictEqual(
    yield* chainCall(
      "Curve inventory unavailable",
      () => node.chain.readContract({ abi: tokenAbi, address: token, functionName: "balanceOf", args: [curve] }),
    ),
    0n,
  );
  assert.strictEqual(
    yield* chainCall("Graduation liquidity unavailable", () =>
      node.chain.readContract({
        abi: parseAbi(["function nativeLiquidity() view returns(uint256)"]),
        address: node.pool,
        functionName: "nativeLiquidity",
      })),
    parseEther("1"),
  );
  assert.isTrue(
    Result.isFailure(
      yield* chainCall("Inactive curve buy", () =>
        node.chain.simulateContract({
          abi: curveAbi,
          address: curve,
          account: node.buyer.account,
          functionName: "buy",
          args: [0n],
          value: 1n,
        })).pipe(Effect.result),
    ),
  );
});

it.layer(financialFloor)("launch and lock", test => {
  test.effect(
    "casts exact sourced launch parameters and enforces seven days on direct, allowance and curve transfers",
    () =>
      Effect.gen(function*() {
        const node = yield* FinancialChain;
        const proposals = yield* Proposals;
        yield* insertFinancialEvidence;
        const receipt = yield* proposals.submit(node.ownerIdentity, node.launch);
        assert.strictEqual(receipt.status, "confirmed");
        if (node.launch.action !== "launch") return;
        const curve = yield* chainCall("Launched curve missing", () =>
          node.chain.readContract({
            abi: floorFoundryAbi,
            address: node.factory,
            functionName: "launches",
            args: [node.launch.launch.launchId],
          }));
        const token = yield* chainCall(
          "Launched token missing",
          () => node.chain.readContract({ abi: curveAbi, address: curve, functionName: "token" }),
        );
        assert.strictEqual(
          yield* chainCall(
            "Locked allocation unavailable",
            () =>
              node.chain.readContract({
                abi: tokenAbi,
                address: token,
                functionName: "balanceOf",
                args: [node.address],
              }),
          ),
          parseEther("100000"),
        );
        yield* allocationLockProof(curve, token);
        yield* graduationProof(curve, token);
      }),
    60_000,
  );
});
