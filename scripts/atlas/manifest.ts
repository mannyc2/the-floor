import { Crypto, Effect, FileSystem, Path, Schema } from "effect";
import * as Hex from "effect/encoding/Hex";
import { renderAtlasOutputs } from "./outputs";

export const sourcePaths = [
  "packages/atlas/src/tokens.ts",
  "packages/atlas/src/materials.ts",
  "packages/atlas/src/look.ts",
  "packages/atlas/src/proportions.ts",
  "packages/atlas/src/camera.ts",
  "scripts/build-atlas.ts",
  "scripts/atlas/outputs.ts",
  "scripts/atlas/manifest.ts",
];
export const outputPaths = [
  "packages/atlas/generated/atlas.css",
  "packages/atlas/generated/palette.ts",
  "packages/atlas/generated/tokens.json",
];
export const manifestPath = "packages/atlas/generated/manifest.json";
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Input = Schema.Struct({ path: Schema.String, sha256: Digest });
const Output = Schema.Struct({ path: Schema.String, sha256: Digest, sources: Schema.Array(Schema.String) });
export const AtlasManifest = Schema.Struct({
  version: Schema.Literal(1),
  generator: Schema.Literal("scripts/build-atlas.ts"),
  sources: Schema.Array(Input),
  outputs: Schema.Array(Output),
});
export const AtlasManifestJson = Schema.fromJsonString(AtlasManifest, { space: 2 });

export class AtlasGeneratedError extends Schema.TaggedError<AtlasGeneratedError>()("AtlasGeneratedError", {
  file: Schema.String,
  message: Schema.String,
}) {}

const digest = Effect.fnUntraced(function*(bytes: Uint8Array) {
  const crypto = yield* Crypto.Crypto;
  return Hex.encode(yield* crypto.digest("SHA-256", bytes));
});

const createManifest = Effect.fn("Atlas.createManifest")(function*(
  root: string,
  outputs: ReadonlyArray<{ readonly path: string; readonly content: string }>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sources = yield* Effect.forEach(sourcePaths, file =>
    fs.readFile(path.join(root, file)).pipe(
      Effect.flatMap(digest),
      Effect.map(sha256 => ({ path: file, sha256 })),
    ));
  const generated = yield* Effect.forEach(
    outputs,
    output =>
      digest(new TextEncoder().encode(output.content)).pipe(
        Effect.map(sha256 => ({ path: output.path, sha256, sources: sourcePaths })),
      ),
  );
  return AtlasManifest.make({ version: 1, generator: "scripts/build-atlas.ts", sources, outputs: generated });
});

/** @internal Host tooling only; this platform boundary is not an Atlas package API. */
export const buildAtlas = Effect.fn("Atlas.build")(function*(root: string = ".") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outputs = yield* renderAtlasOutputs();
  yield* fs.makeDirectory(path.join(root, "packages/atlas/generated"), { recursive: true });
  for (const output of outputs) yield* fs.writeFileString(path.join(root, output.path), output.content);
  const manifest = yield* createManifest(root, outputs);
  const content = yield* Schema.encodeEffect(AtlasManifestJson)(manifest);
  yield* fs.writeFileString(path.join(root, manifestPath), content + "\n");
});

/** @internal Host tooling only; validation retains its filesystem and Crypto requirements. */
export const verifyGeneratedAtlas = Effect.fn("Atlas.verifyGenerated")(function*(root: string = ".") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outputs = yield* renderAtlasOutputs();
  const expected = yield* createManifest(root, outputs);
  const actual = yield* fs.readFileString(path.join(root, manifestPath)).pipe(
    Effect.flatMap(Schema.decodeEffect(AtlasManifestJson)),
  );
  // Hashes alone would let a hand edit bless itself by updating the manifest.
  // Regenerating in memory ties both inventories and exact output bytes to code.
  if (!Schema.toEquivalence(AtlasManifest)(expected, actual)) {
    return yield* new AtlasGeneratedError({
      file: manifestPath,
      message: "Atlas source or output manifest drift; run bun scripts/build-atlas.ts and review the changes",
    });
  }
  const canonicalManifest = (yield* Schema.encodeEffect(AtlasManifestJson)(expected)) + "\n";
  const manifestDigest = yield* fs.readFile(path.join(root, manifestPath)).pipe(Effect.flatMap(digest));
  if (manifestDigest !== (yield* digest(new TextEncoder().encode(canonicalManifest)))) {
    return yield* new AtlasGeneratedError({
      file: manifestPath,
      message: "Generated Atlas manifest bytes differ from its source",
    });
  }
  const listed = new Set([...outputPaths, manifestPath]);
  for (const relative of yield* fs.readDirectory(path.join(root, "packages/atlas/generated"), { recursive: true })) {
    const file = path.join("packages/atlas/generated", relative);
    if (!listed.has(file)) {
      return yield* new AtlasGeneratedError({ file, message: "Unlisted generated Atlas output" });
    }
  }
  for (const output of expected.outputs) {
    const observed = yield* fs.readFile(path.join(root, output.path)).pipe(Effect.flatMap(digest));
    if (observed !== output.sha256) {
      return yield* new AtlasGeneratedError({
        file: output.path,
        message: "Generated Atlas output differs from its source",
      });
    }
  }
  return new Set(outputPaths);
});
