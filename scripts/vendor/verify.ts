import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Path, Schema, Stream } from "effect";
import * as Hex from "effect/encoding/Hex";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const FileName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._@-]+$/));
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Version = Schema.Literal("0.1.0-beta.166-floor.0adbcff.403.2");
const PackageName = Schema.Literals([
  "@yielded/agent",
  "@yielded/agent-storage-sql",
  "@yielded/agent-storage-cloudflare",
  "@yielded/agent-platform-cloudflare",
  "@yielded/agent-platform-alchemy-cloudflare",
  "@yielded/agent-testing",
]);
const Artifact = Schema.Struct({ path: FileName, sha256: Digest });
const Provenance = Schema.Struct({
  upstream: Schema.Struct({ patch: FileName, patchSha256: Digest }),
  buildInputs: Schema.Array(Artifact),
  packages: Schema.Array(Schema.Struct({
    name: PackageName,
    version: Version,
    filename: FileName,
    sha256: Digest,
    packedManifestSha256: Digest,
  })),
});
const CompiledPath = Schema.String.check(
  Schema.isPattern(/^\.\/dist\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:mjs|d\.mts)$/),
);
const PackageManifest = Schema.Struct({
  name: Schema.String,
  version: Version,
  exports: Schema.Record(Schema.String, Schema.Struct({ types: CompiledPath, default: CompiledPath })),
});

class PackageVerificationError extends Schema.TaggedError<PackageVerificationError>()("PackageVerificationError", {
  path: Schema.String,
  message: Schema.String,
}) {}

const digest = Effect.fn("verify.digest")(function*(bytes: Uint8Array) {
  const crypto = yield* Crypto.Crypto;
  return Hex.encode(yield* crypto.digest("SHA-256", bytes));
});

const readArchive = Effect.fn("verify.readArchive")(function*(args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const process = yield* spawner.spawn(ChildProcess.make("tar", args));
  const output = yield* process.stdout.pipe(Stream.decodeText(), Stream.mkString);
  const exitCode = yield* process.exitCode;
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* new PackageVerificationError({ path: args.join(" "), message: "Archive command failed" });
  }
  return output;
}, Effect.scoped);

const verify = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* path.fromFileUrl(new URL("../../vendor/yielded/0adbcff-effect-4.0.3/", import.meta.url));
  const provenance = yield* fs.readFileString(path.join(directory, "provenance.json")).pipe(
    Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Provenance))),
  );
  if (provenance.packages.length !== 6 || new Set(provenance.packages.map((pkg) => pkg.name)).size !== 6) {
    return yield* new PackageVerificationError({
      path: "provenance.json",
      message: "Expected the six distinct packages",
    });
  }
  const artifacts = [
    ...provenance.buildInputs,
    ...provenance.packages.map((pkg) => ({ path: pkg.filename, sha256: pkg.sha256 })),
    { path: provenance.upstream.patch, sha256: provenance.upstream.patchSha256 },
  ];
  for (const artifact of artifacts) {
    const observed = yield* fs.readFile(path.join(directory, artifact.path)).pipe(Effect.flatMap(digest));
    if (observed !== artifact.sha256) {
      return yield* new PackageVerificationError({ path: artifact.path, message: "Artifact hash mismatch" });
    }
  }
  for (const pkg of provenance.packages) {
    const tarball = path.join(directory, pkg.filename);
    const paths = new Set((yield* readArchive(["-tf", tarball])).split("\n"));
    const manifestText = yield* readArchive(["-xOf", tarball, "package/package.json"]);
    const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(PackageManifest))(manifestText);
    const manifestHash = yield* digest(new TextEncoder().encode(manifestText));
    if (manifest.name !== pkg.name || manifest.version !== pkg.version || !paths.has("package/LICENSE")) {
      return yield* new PackageVerificationError({
        path: pkg.filename,
        message: "Package identity or license mismatch",
      });
    }
    if (manifestHash !== pkg.packedManifestSha256) {
      return yield* new PackageVerificationError({ path: pkg.filename, message: "Manifest hash mismatch" });
    }
    for (const target of Object.values(manifest.exports)) {
      for (const entry of [target.types, target.default]) {
        if (!paths.has("package/" + entry.slice(2))) {
          return yield* new PackageVerificationError({
            path: pkg.filename,
            message: "Missing compiled export " + entry,
          });
        }
      }
    }
  }
  return yield* Effect.log("Verified six private Yielded packages, compiled exports, licenses and pinned patches.");
});

// oxlint-disable-next-line effecttsgo/strict-effect-provide, effect/noInlineProvide -- This finite command boundary owns and closes the Bun platform services.
const main = verify.pipe(Effect.provide(BunServices.layer));
BunRuntime.runMain(main);
