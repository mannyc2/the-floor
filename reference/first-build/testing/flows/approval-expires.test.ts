import { assert, it } from "@effect/vitest";
import { authorizeReceipt, Signing } from "@floor/signing";
import { DateTime, Effect, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Atlas } from "../../packages/server/src/atlas";
import { Proposals } from "../../packages/server/src/proposals";
import { FloorDatabase } from "../../packages/server/src/store";
import { FinancialChain } from "./_fixtures/financial-chain";
import { financialFloor, insertFinancialEvidence } from "./_fixtures/financial-floor";
import { SignerTrace } from "./_fixtures/scoped-signer-edge";

it.layer(financialFloor)("approval expires", test => {
  test.effect(
    "expires unanswered approval through the real atlas refresh and cannot dispatch after restart-style observation",
    () =>
      Effect.gen(function*() {
        const node = yield* FinancialChain;
        const db = yield* FloorDatabase;
        const proposals = yield* Proposals;
        const signing = yield* Signing;
        const trace = yield* SignerTrace;
        yield* insertFinancialEvidence;
        yield* db.agents.update({ ...node.agent, policy: { ...node.agent.policy, approvalThresholdUsd: 10 } });
        const pending = yield* proposals.submit(node.ownerIdentity, node.proposal);
        assert.strictEqual(pending.status, "awaiting-approval");
        yield* TestClock.adjust("16 minutes");
        yield* (yield* Atlas).refresh;
        const expired = (yield* db.receipts.findById(pending.id)).data;
        assert.strictEqual(expired.status, "expired");
        assert.isTrue(Option.isNone(Option.fromNullishOr(expired.transactionHash)));
        const late = yield* Effect.fromResult(
          authorizeReceipt(expired, node.ownerIdentity.id, "approve", DateTime.formatIso(yield* DateTime.now)),
        );
        assert.strictEqual(late.status, "expired");
        assert.strictEqual((yield* signing.dispatchApproved(late.id)).status, "expired");
        assert.strictEqual(yield* Ref.get(trace.dispatches), 0);
        assert.isFalse((yield* Ref.get(trace.requests)).includes("/v1/transactions/prepare"));
      }),
    60_000,
  );
});
