import { assert, it } from "@effect/vitest";
import { type Proposal, withoutTransaction } from "@floor/contract";
import {
  calibrationLegend,
  calibrationReadings,
  DesignRenderer,
  DesignRenderError,
  GateDecisionInput,
  GateDecisions,
  GateReview,
} from "@floor/gate";
import { authorizeReceipt, createReceipt, Signing } from "@floor/signing";
import { Array, Context, Data, DateTime, Effect, Exit, Layer, Option, Record, Ref, Schema } from "effect";
import { DecisionModel } from "effect/ai";
import { FinancialChain } from "../../../testing/flows/_fixtures/financial-chain";
import { financialFloorCore, insertFinancialEvidence } from "../../../testing/flows/_fixtures/financial-floor";
import { SignerTrace } from "../../../testing/flows/_fixtures/scoped-signer-edge";
import { AccountContext } from "../src/account-context";
import { LaunchReviewEvidence, LaunchReviews } from "../src/launch-reviews";
import { Proposals } from "../src/proposals";
import { FloorDatabase } from "../src/store";

class GateControl extends Context.Service<GateControl, {
  readonly score: Ref.Ref<number>;
  readonly renderAvailable: Ref.Ref<boolean>;
  readonly requests: Ref.Ref<readonly typeof GateDecisionInput.Type[]>;
}>()("test/GateControl") {}
const control = (score: number, renderAvailable = true) =>
  Layer.effect(
    GateControl,
    Effect.gen(function*() {
      return GateControl.of({
        score: yield* Ref.make(score),
        renderAvailable: yield* Ref.make(renderAvailable),
        requests: yield* Ref.make<readonly typeof GateDecisionInput.Type[]>([]),
      });
    }),
  );
const answer = Data.taggedEnum<DecisionModel.ProviderAnswer>();
const render = Layer.effect(
  DesignRenderer,
  Effect.gen(function*() {
    const controller = yield* GateControl;
    return DesignRenderer.of({
      render: Effect.fn("LaunchGateTest.render")(function*(design) {
        if (!(yield* Ref.get(controller.renderAvailable))) {
          return yield* new DesignRenderError({ message: "Renderer disconnected" });
        }
        return {
          image:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          samples: calibrationReadings(design),
          legend: calibrationLegend,
        };
      }),
    });
  }),
);
const decisions = Layer.effect(
  GateDecisions,
  Effect.gen(function*() {
    const controller = yield* GateControl;
    return Option.some(
      yield* DecisionModel.make({
        decide: Effect.fn("LaunchGateTest.decide")(function*(options) {
          const input = yield* Schema.decodeUnknownEffect(GateDecisionInput)(options.state);
          yield* Ref.update(controller.requests, requests => [...requests, input]);
          assert.isTrue(Option.isSome(input.launch));
          const probability = yield* Ref.get(controller.score);
          return {
            answers: Record.map(options.decisions, () => answer.Probability({ probability })),
            usage: { inputTokens: 20, outputTokens: 20 },
          };
        }, Effect.orDie),
      }),
    );
  }),
);
const application = (score: number, renderAvailable = true) =>
  financialFloorCore.pipe(
    Layer.provide(GateReview.layer.pipe(Layer.provide([render, decisions]))),
    Layer.provideMerge(control(score, renderAvailable)),
  );

const noDispatch = Effect.gen(function*() {
  const trace = yield* SignerTrace;
  assert.strictEqual(yield* Ref.get(trace.dispatches), 0);
  assert.isFalse((yield* Ref.get(trace.requests)).some(request => request.includes("prepare")));
});

it.layer(application(0.95, false))("unavailable launch review", test => {
  test.effect("keeps direct proposals pending, and owner approval or direct dispatch cannot bypass review", () =>
    Effect.gen(function*() {
      const node = yield* FinancialChain;
      const proposals = yield* Proposals;
      const signing = yield* Signing;
      const db = yield* FloorDatabase;
      yield* insertFinancialEvidence;
      const pending = yield* proposals.submit(node.ownerIdentity, node.launch);
      assert.strictEqual(pending.status, "pending-review");
      assert.include(pending.reason, "Renderer disconnected");
      const answered = yield* Effect.fromResult(
        authorizeReceipt(pending, node.ownerIdentity.id, "approve", DateTime.formatIso(yield* DateTime.now)),
      );
      assert.strictEqual(answered.status, "pending-review");
      yield* db.receipts.update({ id: answered.id, data: answered });
      assert.strictEqual((yield* signing.dispatchApproved(answered.id)).status, "pending-review");
      yield* noDispatch;
    }));
});

it.layer(application(0.2))("rejected launch review", test => {
  test.effect("judges the exact declaration and sourced thesis before refusing an alternate proposal caller", () =>
    Effect.gen(function*() {
      const node = yield* FinancialChain;
      const proposals = yield* Proposals;
      const controller = yield* GateControl;
      const db = yield* FloorDatabase;
      yield* insertFinancialEvidence;
      yield* db.launches.insert({
        id: "reviewed-draft",
        owner: node.ownerIdentity.id,
        agentId: node.agent.id,
        name: "Declared Tide",
        symbol: "TIDE",
        thesis: "Declared launch narrative must also be judged",
        allocationPercent: 10,
        createdAt: node.launch.createdAt,
        status: "draft",
        // oxlint-disable-next-line effect/noNullish -- The persisted draft has no receipt until the canonical submission below.
        receiptId: null,
      });
      const proposal = {
        ...node.launch,
        id: "launch:reviewed-draft",
        launch: { ...node.launch.launch, name: "Declared Tide", symbol: "TIDE" },
      } satisfies Proposal;
      const refused = yield* proposals.submit(node.ownerIdentity, proposal);
      assert.strictEqual(refused.status, "refused");
      assert.isTrue(
        refused.checks.some(check => check.rule === "Launch gate: Judgment: no-impersonation" && !check.passed),
      );
      const request = yield* Effect.fromOption(Array.head(yield* Ref.get(controller.requests)));
      const content = yield* Effect.fromOption(request.launch);
      assert.strictEqual(content.launch.name, "Declared Tide");
      assert.strictEqual(content.launch.symbol, "TIDE");
      assert.strictEqual(content.declaration, "Declared launch narrative must also be judged");
      assert.strictEqual(content.thesis.id, proposal.thesisId);
      assert.strictEqual(content.notes[0]?.id, "financial-note");
      yield* noDispatch;
    }));
});

it.layer(application(0.65))("pending launch retry", test => {
  test.effect("only retries the identical canonical proposal and persists the exact accepted render and decision evidence", () =>
    Effect.gen(function*() {
      const node = yield* FinancialChain;
      const proposals = yield* Proposals;
      const controller = yield* GateControl;
      const evidence = yield* LaunchReviewEvidence;
      yield* insertFinancialEvidence;
      const pending = yield* proposals.submit(node.ownerIdentity, node.launch);
      assert.strictEqual(pending.status, "pending-review");
      const mutated = yield* Effect.exit(
        proposals.submit(node.ownerIdentity, {
          ...node.launch,
          launch: { ...node.launch.launch, name: "Changed after review" },
        }),
      );
      assert.isTrue(Option.exists(Exit.findErrorOption(mutated), error => error._tag === "ApiError"));
      assert.strictEqual((yield* Ref.get(controller.requests)).length, 1);
      yield* Ref.set(controller.score, 0.95);
      const confirmed = yield* proposals.submit(node.ownerIdentity, node.launch);
      assert.strictEqual(confirmed.status, "confirmed");
      assert.strictEqual(confirmed.createdAt, pending.createdAt);
      const stored = yield* Effect.fromOption(yield* evidence.read(node.launch.id));
      assert.strictEqual(stored.result.status, "accepted");
      assert.match(stored.inputHash, /^[0-9a-f]{64}$/);
      assert.isTrue(Option.isSome(stored.imageHash));
      assert.isTrue(Option.isSome(stored.result.image));
      assert.strictEqual(stored.result.probabilities["judgment:no-slurs"], 0.95);
      assert.isFalse(yield* evidence.accepted({ ...node.launch, launch: { ...node.launch.launch, symbol: "OTHER" } }));
      yield* proposals.submit(node.ownerIdentity, node.launch);
      assert.strictEqual(yield* Ref.get((yield* SignerTrace).dispatches), 1);
    }));
});

it.layer(application(0.95))("launch gate reservation boundary", test => {
  test.effect("refuses a directly stored approved receipt without matching accepted review evidence", () =>
    Effect.gen(function*() {
      const node = yield* FinancialChain;
      const db = yield* FloorDatabase;
      const context = yield* AccountContext;
      const signing = yield* Signing;
      yield* insertFinancialEvidence;
      yield* db.proposals.insert(node.launch);
      const checked = createReceipt(
        node.launch,
        node.agent.policy,
        yield* context.load(node.agent, node.ownerIdentity, Option.some(node.launch)),
      );
      yield* db.receipts.insert({ data: withoutTransaction({ ...checked, status: "approved", action: "launch" }) });
      const refused = yield* signing.dispatchApproved(checked.id);
      assert.strictEqual(refused.status, "refused");
      assert.isTrue(refused.checks.some(check => check.rule === "Launch gate" && !check.passed));
      yield* noDispatch;
    }));
});
it.layer(application(0.95))("changed launch evidence", test => {
  test.effect("invalidates accepted evidence when a persisted thesis changes before reservation", () =>
    Effect.gen(function*() {
      const node = yield* FinancialChain;
      const db = yield* FloorDatabase;
      const context = yield* AccountContext;
      const signing = yield* Signing;
      const reviews = yield* LaunchReviews;
      const evidence = yield* LaunchReviewEvidence;
      yield* insertFinancialEvidence;
      const proposal = { ...node.launch, id: "changed-thesis-launch" };
      yield* db.proposals.insert(proposal);
      yield* reviews.review(proposal);
      assert.isTrue(yield* evidence.accepted(proposal));
      const checked = createReceipt(
        proposal,
        node.agent.policy,
        yield* context.load(node.agent, node.ownerIdentity, Option.some(proposal)),
      );
      assert.strictEqual(checked.status, "approved");
      yield* db.receipts.insert({ data: checked });
      const thesis = yield* db.theses.findById(proposal.thesisId);
      yield* db.theses.update({
        id: thesis.id,
        agentId: thesis.agentId,
        marketId: thesis.marketId,
        noteIds: thesis.noteIds,
        createdAt: thesis.createdAt,
        invalidation: thesis.invalidation,
        belief: "A materially different launch justification",
      });
      assert.isFalse(yield* evidence.accepted(proposal));
      assert.strictEqual((yield* signing.dispatchApproved(checked.id)).status, "refused");
      yield* noDispatch;
    }));
});
