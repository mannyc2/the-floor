import { BunServices } from "@effect/platform-bun";
import { expect, test } from "bun:test";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { runTest } from "./_runtime";

interface Fixture {
  readonly file: string;
  readonly source: string;
  readonly errors: number;
}
const DiagnosticOutput = Schema.Struct({
  diagnostics: Schema.Array(Schema.Struct({ filename: Schema.String, code: Schema.String })),
});
const execute = Effect.fnUntraced(function*(command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);
  return yield* Effect.all({
    output: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
    error: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
    code: child.exitCode,
  }, { concurrency: "unbounded" });
});
const lintFixtures = Effect.fnUntraced(function*(fixtures: readonly Fixture[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspace = yield* path.fromFileUrl(new URL("../../../", import.meta.url));
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "lint-engine-" });
  yield* fs.symlink(path.join(workspace, "node_modules"), path.join(directory, "node_modules"));
  const compiled = yield* execute(ChildProcess.make("bun", [
    "build",
    path.join(workspace, "scripts/lint/plugin.ts"),
    "--target=node",
    "--external",
    "effect",
    "--external",
    "effect-oxlint",
    "--outfile",
    path.join(directory, "plugin.mjs"),
  ], { cwd: workspace, forceKillAfter: "5 seconds" }));
  expect(compiled.code).toBe(ChildProcessSpawner.ExitCode(0));
  yield* fs.writeFileString(
    path.join(directory, "oxlint.json"),
    `{
    "categories": { "correctness": "off" },
    "jsPlugins": [{ "name": "floor", "specifier": "./plugin.mjs" }],
    "rules": { "floor/chain-neutral-schemas": "error" }
  }`,
  );
  for (const fixture of fixtures) {
    const filename = path.join(directory, fixture.file);
    yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
    yield* fs.writeFileString(filename, `import { Schema } from "effect";\n${fixture.source}\n`);
  }
  const result = yield* execute(ChildProcess.make(path.join(workspace, "node_modules/.bin/oxlint"), [
    "--config",
    "oxlint.json",
    "--no-ignore",
    "--format",
    "json",
    ...fixtures.map(fixture => fixture.file),
  ], { cwd: directory, forceKillAfter: "5 seconds" }));
  expect(result.error).toBe("");
  const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(DiagnosticOutput))(result.output);
  expect(decoded.diagnostics.every(diagnostic => diagnostic.code === "floor(chain-neutral-schemas)")).toBe(true);
  expect(fixtures.map(fixture => ({
    file: fixture.file,
    errors: decoded.diagnostics.filter(diagnostic => diagnostic.filename === fixture.file).length,
  }))).toEqual(fixtures.map(fixture => ({ file: fixture.file, errors: fixture.errors })));
  expect(result.code).toBe(ChildProcessSpawner.ExitCode(fixtures.some(fixture => fixture.errors > 0) ? 1 : 0));
});
const fixture = (name: string, source: string, errors: number): Fixture => ({
  file: `packages/contract/src/${name}.ts`,
  source,
  errors,
});

test(
  "Oxlint rejects each raw chain encoding independently through its real parser and scope engine",
  () =>
    runTest(
      lintFixtures([
        fixture("slot", "export const SolCheckpoint = Schema.Struct({ slot: Schema.Int });", 1),
        fixture("blocknumber", "export const RawBlock = Schema.Struct({ blocknumber: Schema.Int });", 1),
        fixture("block-num", "export const RawBlock = Schema.Struct({ blockNum: Schema.Int });", 1),
        fixture("sats", "export const Amount = Schema.Struct({ sats: Schema.BigInt });", 1),
        fixture("sats-literal", "export const Unit = Schema.Literal('sats');", 1),
        fixture(
          "filter-if",
          `export const GuardedHex = Schema.String.check(Schema.makeFilter((s: string) => {
      if (!s.startsWith("0x")) return false;
      return true;
    }));`,
          1,
        ),
        fixture(
          "member-regex",
          `const patterns = { hex: /^0x[0-9a-f]+$/ };
      export const MemberHex = Schema.String.check(Schema.isPattern(patterns.hex));`,
          1,
        ),
        fixture(
          "computed-member-regex",
          `const patterns = { hex: /^0x[0-9a-f]+$/ };
      export const MemberHex = Schema.String.check(Schema.isPattern(patterns["hex"]));`,
          1,
        ),
        fixture(
          "constant-computed-member-regex",
          `const key = "hex";
      const patterns = { hex: /^0x[0-9a-f]+$/ };
      export const MemberHex = Schema.String.check(Schema.isPattern(patterns[key]));`,
          1,
        ),
        fixture(
          "nested-member-regex",
          `const patterns = { account: { hex: /^0x[0-9a-f]+$/ } };
      const nested = patterns.account;
      export const MemberHex = Schema.String.check(Schema.isPattern(nested.hex));`,
          1,
        ),
        fixture(
          "nested-computed-member-regex",
          `const keys = { account: "account", hex: "hex" };
      const patterns = { account: { hex: /^0x[0-9a-f]+$/ } };
      export const MemberHex = Schema.String.check(Schema.isPattern(patterns[keys.account][keys.hex]));`,
          1,
        ),
        fixture(
          "piped-regex",
          "export const Hex = Schema.String.pipe(Schema.check(Schema.isPattern(/^0x[0-9a-f]+$/)));",
          1,
        ),
        fixture("wei", "export const Amount = Schema.Struct({ amountWei: Schema.BigInt });", 1),
      ]),
      BunServices.layer,
    ),
  15000,
);

test(
  "Oxlint accepts neutral text, moderation flags, constructed data and actual adapter Schemas",
  () =>
    runTest(
      lintFixtures([
        fixture("leverage", "export const Leverage = Schema.Literals([\"1x\", \"2x\", \"10x\", \"100x\"]);", 0),
        fixture("resolution", "export const Resolution = Schema.Literal(\"1920x1080\");", 0),
        fixture("piece-shape", "export const PieceShape = Schema.Literals([\"block\", \"cylinder\", \"slab\"]);", 0),
        fixture("moderation", "export const Moderation = Schema.Struct({ block: Schema.Boolean });", 0),
        fixture(
          "constructed-data",
          `const Checkpoint = Schema.Struct({ height: Schema.String });
      export const block = Checkpoint.make({ height: "1" });`,
          0,
        ),
        fixture(
          "base58",
          "export const Identifier = Schema.String.check(Schema.isPattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/));",
          0,
        ),
        fixture(
          "unused-member",
          `const patterns = { address: /^0x[0-9a-f]+$/, label: /^[a-z]+$/ };
      export const Label = Schema.String.check(Schema.isPattern(patterns.label));`,
          0,
        ),
        fixture(
          "unused-computed-member",
          `const key = "label";
      const patterns = { address: /^0x[0-9a-f]+$/, label: /^[a-z]+$/ };
      export const Label = Schema.String.check(Schema.isPattern(patterns[key]));`,
          0,
        ),
        {
          file: "packages/chains/src/solana/checkpoint.ts",
          source: "export const Checkpoint = Schema.Struct({ slot: Schema.Int });",
          errors: 0,
        },
        {
          file: "packages/chains/src/evm/hex.ts",
          source: "export const Address = Schema.String.check(Schema.isPattern(/^0x[0-9a-f]+$/));",
          errors: 0,
        },
      ]),
      BunServices.layer,
    ),
  15000,
);
