import { assert, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { budgetGroups, Manifest } from "../model";

it.effect("counts shared imports once and excludes initial bytes from the deferred budget", () =>
  Effect.gen(function*() {
    const manifest = yield* Schema.decodeEffect(Manifest)({
      entry: { file: "main.js", isEntry: true, imports: ["shared"], css: ["main.css"] },
      shared: { file: "shared.js", imports: ["entry"], css: ["main.css"] },
      renderer: { file: "renderer.js", isDynamicEntry: true, imports: ["entry", "shared"] },
    });
    const result = budgetGroups(manifest);
    assert.isTrue(Result.isSuccess(result));
    if (Result.isFailure(result)) return;
    assert.deepEqual(result.success.map((group) => ({ ...group, files: group.files.toSorted() })), [
      { name: "Initial JavaScript + CSS", files: ["main.css", "main.js", "shared.js"], maximumBytes: 204800 },
      { name: "Deferred JavaScript + CSS", files: ["renderer.js"], maximumBytes: 184320 },
    ]);
  }));

it.effect("fails closed when a static import is absent from the manifest", () =>
  Effect.gen(function*() {
    const manifest = yield* Schema.decodeEffect(Manifest)({
      entry: { file: "main.js", isEntry: true, imports: ["missing"] },
      renderer: { file: "renderer.js", isDynamicEntry: true },
    });
    const result = budgetGroups(manifest);
    assert.isTrue(Result.isFailure(result));
    if (Result.isSuccess(result)) return;
    assert.include(result.failure.message, "Missing manifest import: missing");
  }));

it.effect("requires the renderer to remain deferred", () =>
  Effect.gen(function*() {
    const manifest = yield* Schema.decodeEffect(Manifest)({ entry: { file: "main.js", isEntry: true } });
    assert.isTrue(Result.isFailure(budgetGroups(manifest)));
  }));
