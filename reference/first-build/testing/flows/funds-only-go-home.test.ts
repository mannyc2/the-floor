import { assert, it } from "@effect/vitest";
import { Proposal } from "@floor/contract";
import { authorizeReceipt, Signing } from "@floor/signing";
import { DateTime, Effect, Ref } from "effect";
import { parseEther } from "viem";
import { Proposals } from "../../packages/server/src/proposals";
import { FloorDatabase } from "../../packages/server/src/store";
import { chainCall } from "./_fixtures/anvil";
import { FinancialChain } from "./_fixtures/financial-chain";
import { financialFloor, insertFinancialEvidence } from "./_fixtures/financial-floor";
import { SignerTrace } from "./_fixtures/scoped-signer-edge";

it.layer(financialFloor)("funds only go home", test => {
  test.effect(
    "persists refusals for altered withdrawals and pays only the bound owner after explicit approval",
    () =>
      Effect.gen(function*() {
        const node = yield* FinancialChain;
        const db = yield* FloorDatabase;
        const proposals = yield* Proposals;
        const trace = yield* SignerTrace;
        yield* insertFinancialEvidence;
        yield* db.agents.update({ ...node.agent, paused: true, state: "asleep" });
        const withdrawal = Proposal.make({
          ...node.proposal,
          id: "home-withdrawal",
          action: "withdraw",
          protocol: "owner-withdrawal",
          contract: node.address,
          method: "withdrawToOwner",
          recipient: node.owner.account.address,
        });
        for (
          const altered of [
            { id: "wrong-recipient", recipient: node.buyer.account.address },
            { id: "wrong-account", contract: node.buyer.account.address },
            { id: "wrong-method", method: "ownerCall" },
          ]
        ) {
          const refusal = yield* proposals.submit(node.ownerIdentity, { ...withdrawal, ...altered });
          assert.strictEqual(refusal.status, "refused");
          assert.strictEqual((yield* db.receipts.findById(refusal.id)).data.status, "refused");
        }
        const pending = yield* proposals.submit(node.ownerIdentity, withdrawal);
        assert.strictEqual(pending.status, "awaiting-approval");
        assert.strictEqual(yield* Ref.get(trace.dispatches), 0);
        const approved = yield* Effect.fromResult(
          authorizeReceipt(pending, node.ownerIdentity.id, "approve", DateTime.formatIso(yield* DateTime.now)),
        );
        yield* db.receipts.update({ id: approved.id, data: approved });
        const before = yield* chainCall(
          "Account balance unavailable before withdrawal",
          () => node.chain.getBalance({ address: node.address }),
        );
        const receipt = yield* (yield* Signing).dispatchApproved(approved.id);
        assert.strictEqual(receipt.status, "confirmed");
        const after = yield* chainCall(
          "Account balance unavailable after withdrawal",
          () => node.chain.getBalance({ address: node.address }),
        );
        assert.strictEqual(before - after, parseEther(withdrawal.amount));
        assert.strictEqual(yield* Ref.get(trace.dispatches), 1);
      }),
    60_000,
  );
});
