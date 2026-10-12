import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { researchNote, undisclosedPosition } from "@floor/contract";
import {
  calibrationReadings,
  GateDecisionInput,
  GateDecisions,
  GateReview,
  LaunchContent,
  LaunchGate,
  lilyPondDesign,
} from "@floor/gate";
import { ConfigProvider, Context, Data, Effect, FileSystem, Layer, Option, Record, Schema } from "effect";
import { DecisionModel } from "effect/ai";
import { Base64 } from "effect/encoding";
import { HttpRouter, HttpServer, HttpStaticServer } from "effect/http";
import { ChildProcess } from "effect/process";
import { ServerConfig } from "../../packages/server/src/config";
import { DesignRendererLive } from "../../packages/server/src/design-review";

class GateAssets extends Context.Service<GateAssets, string>()("flow/GateAssets") {}
class GateFlowError extends Schema.TaggedError<GateFlowError>()("GateFlowError", { message: Schema.String }) {}
const assets = Layer.effect(
  GateAssets,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "floor-gate-assets-" });
    // Build isolated production assets so the flow also works from a clean checkout without replacing a running demo's files.
    const build = yield* ChildProcess.make("bun", ["run", "node_modules/vite/bin/vite.js", "build", "--outDir", root], {
      stdout: "ignore",
      stderr: "inherit",
      forceKillAfter: "5 seconds",
    });
    if ((yield* build.exitCode) !== 0) {
      return yield* new GateFlowError({ message: "The trusted gate renderer did not build." });
    }
    return root;
  }),
);
const staticRoutes = Layer.unwrap(Effect.map(GateAssets, root => HttpStaticServer.layer({ root })));
const host = HttpRouter.serve(staticRoutes).pipe(
  Layer.provideMerge(BunHttpServer.layer({ hostname: "127.0.0.1", port: 0 })),
);
const configuration = Layer.effect(
  ServerConfig,
  HttpServer.addressFormattedWith(origin =>
    Effect.succeed(ServerConfig.of({
      hostname: "127.0.0.1",
      port: Number(new URL(origin).port),
      origin,
      local: true,
      foundry: Option.none(),
    }))
  ),
);
const providerAnswer = Data.taggedEnum<DecisionModel.ProviderAnswer>();
const fixtures = [
  { id: "gate-flow-accepted", probability: 0.95, expected: "accepted" },
  { id: "gate-flow-review", probability: 0.65, expected: "review" },
  { id: "gate-flow-rejected", probability: 0.2, expected: "rejected" },
] as const;
const launchContent: LaunchContent = {
  launch: {
    launchId: `0x${"8".repeat(64)}`,
    name: "Sourced Tide",
    symbol: "TIDE",
    supply: "1000000",
    allocation: "100000",
    graduationThresholdWei: "1000000000000000000",
    virtualLiquidityWei: "1000000000000000000",
    launchFeeWei: "0",
    thesisHash: `0x${"9".repeat(64)}`,
  },
  declaration: "A testnet instrument for checking a sourced use case.",
  thesis: {
    id: "browser-launch-thesis",
    agentId: "browser-desk",
    marketId: "observed-market",
    belief: "Test a bounded sourced use case",
    invalidation: "Contradictory evidence",
    noteIds: ["browser-launch-note"],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  notes: [
    researchNote({
      id: "browser-launch-note",
      agentId: "browser-desk",
      marketId: "observed-market",
      claim: "This fixture page describes the proposed use case.",
      sources: [{
        id: "browser-source",
        kind: "web",
        label: "Source fixture",
        url: "https://example.com/launch",
        // oxlint-disable-next-line effect/noNullish -- A web citation has no chain block in the persisted note contract.
        blockNumber: null,
      }],
      position: undisclosedPosition,
      status: "sourced",
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      // oxlint-disable-next-line effect/noNullish -- This sourced web fixture makes no chain measurement claim.
      blockNumber: null,
      verification: "Recorded web source, not a verified chain claim.",
    }),
  ],
};
// The model is a deterministic external provider fixture. It checks the actual PNG and every native decision request before answering.
const decisions = Layer.effect(
  GateDecisions,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory("test-results/gate-flow", { recursive: true });
    return Option.some(
      yield* DecisionModel.make({
        decide: Effect.fn("GateFlow.decide")(function*(options) {
          const input = yield* Schema.decodeUnknownEffect(GateDecisionInput)(options.state);
          const selected = Option.isSome(input.launch)
            ? { id: "launch-gate-browser", probability: 0.95 }
            : yield* Effect.fromOption(
              Option.fromUndefinedOr(fixtures.find(fixture => fixture.id === input.design.id)),
            );
          if (Option.isSome(input.launch)) {
            assert.deepStrictEqual(input.launch.value, launchContent);
            assert.strictEqual(input.design.name, "Sourced Tide (TIDE)");
            assert.include(options.decisions["judgment:no-impersonation"]?.instructions ?? "", "exact launch name");
          }
          assert.match(input.image, /^data:image\/png;base64,/);
          const bytes = yield* Effect.fromResult(Base64.decode(input.image.slice("data:image/png;base64,".length)));
          assert.deepStrictEqual(bytes.subarray(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
          assert.isAbove(bytes.length, 40_000);
          const dimensions = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          assert.strictEqual(dimensions.getUint32(16), 1440);
          assert.strictEqual(dimensions.getUint32(20), 900);
          assert.deepStrictEqual(input.samples, calibrationReadings(input.design));
          assert.include(input.legend, "synthetic");
          for (const reading of Object.keys(input.samples)) assert.property(options.decisions, `legibility:${reading}`);
          assert.property(options.decisions, "judgment:no-scam-links");
          yield* fs.writeFile(`test-results/gate-flow/${selected.id}.png`, bytes);
          return {
            answers: Record.map(
              options.decisions,
              () => providerAnswer.Probability({ probability: selected.probability }),
            ),
            usage: { inputTokens: 30, outputTokens: 30 },
          };
        }, Effect.orDie),
      }),
    );
  }),
);
const application = LaunchGate.layer.pipe(
  Layer.provideMerge(GateReview.layer),
  Layer.provide(DesignRendererLive),
  Layer.provide(decisions),
  Layer.provide(configuration),
  Layer.provide(host),
  Layer.provide(assets),
  Layer.provide(BunServices.layer),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
);

it.layer(application)("Design through the gate", test => {
  test.effect("reviews actual launch text and the default bonding-curve geometry rendered in Chromium", () =>
    Effect.gen(function*() {
      const gate = yield* LaunchGate;
      const result = yield* gate.review(launchContent);
      assert.strictEqual(result.status, "accepted");
      assert.isTrue(result.checks.every(check => check.status === "pass"));
      assert.isTrue(Option.isSome(result.image));
      assert.strictEqual(result.probabilities["judgment:no-impersonation"], 0.95);
    }));
  for (const fixture of fixtures) {
    test.effect(`renders the actual Kit scene and produces named ${fixture.expected} checks`, () =>
      Effect.gen(function*() {
        const gate = yield* GateReview;
        const result = yield* gate.review(
          { ...lilyPondDesign, id: fixture.id },
          Option.some({
            plinthAvailable: true,
            maxWidth: 20,
            maxDepth: 20,
            overlapsMachine: false,
          }),
        );
        assert.strictEqual(result.status, fixture.expected);
        assert.strictEqual(result.checks.find(check => check.name === "Render")?.status, "pass");
        assert.isTrue(result.checks.every(check => check.name.length > 0 && check.detail.length > 0));
        assert.isFalse(result.checks.some(check => check.detail.includes("data:image")));
      }));
  }
  test.effect("rejects a structurally incomplete scene before inference", () =>
    Effect.gen(function*() {
      const gate = yield* GateReview;
      const result = yield* gate.review({ ...lilyPondDesign, id: "not-a-provider-fixture", readings: [] });
      assert.strictEqual(result.status, "rejected");
      assert.isFalse(result.checks.some(check => check.name === "Render"));
    }));
});
