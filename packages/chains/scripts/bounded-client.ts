import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Option, Order, Path, Schema } from "effect";
import { Hex } from "effect/encoding";

class GenerationError extends Schema.TaggedError<GenerationError>()("GenerationError", { invariant: Schema.String }) {}
const Identifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_]*$/));
const Address = Schema.String.check(Schema.isPattern(/^[1-9A-HJ-NP-Za-km-z]+$/));
const Idl = Schema.Struct({
  address: Address,
  instructions: Schema.Array(Schema.Struct({
    name: Identifier,
    discriminator: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))),
    accounts: Schema.Array(Schema.Struct({
      name: Identifier,
      address: Schema.optionalKey(Address),
      writable: Schema.optionalKey(Schema.Boolean),
      signer: Schema.optionalKey(Schema.Boolean),
    })),
    args: Schema.Array(Schema.Struct({ name: Identifier, type: Schema.Unknown })),
  })),
});
const DefinedArgument = Schema.Struct({ defined: Schema.Struct({ name: Identifier }) });
const Provenance = Schema.Struct({ sha256: Schema.String });
const camel = (value: string) => value.replace(/_([a-z])/g, (_whole: string, letter: string) => letter.toUpperCase());
const pascal = (value: string) => {
  const name = camel(value);
  return name.slice(0, 1).toUpperCase() + name.slice(1);
};
const requireValue = <A>(value: Option.Option<A>, invariant: string) =>
  Effect.fromOption(value).pipe(Effect.mapError(() => new GenerationError({ invariant })));

const readIdl = Effect.fn("readPinnedIdl")(function*(packageRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const idlBytes = yield* fs.readFile(`${packageRoot}idl/meteora.json`);
  const provenance = yield* fs.readFileString(`${packageRoot}idl/source.json`).pipe(
    Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Provenance))),
  );
  if (Hex.encode(yield* crypto.digest("SHA-256", idlBytes)) !== provenance.sha256) {
    return yield* new GenerationError({ invariant: "The Meteora IDL differs from its pinned upstream checksum" });
  }
  return yield* Schema.decodeEffect(Schema.fromJsonString(Idl))(new TextDecoder().decode(idlBytes));
});

const readCodecs = Effect.fn("readCodamaCodecs")(function*(generatedRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  const sources = new Map<string, string>();
  const exports = new Map<string, string>();
  for (const filename of yield* fs.readDirectory(generatedRoot)) {
    if (!filename.endsWith(".ts")) continue;
    const source = yield* fs.readFileString(`${generatedRoot}${filename}`);
    sources.set(filename, source);
    for (const match of source.matchAll(/export (?:type|function|const) (\w+)/g)) {
      const name = Option.fromNullishOr(match[1]);
      if (Option.isSome(name)) exports.set(name.value, filename);
    }
  }
  return { sources, exports };
});

const rewriteImports = Effect.fn("rewriteCodamaImports")(
  function*(original: string, exports: ReadonlyMap<string, string>) {
    let rewritten = original;
    const dependencies: Array<string> = [];
    for (const block of original.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.";/gs)) {
      const imported = (block[1] ?? "").split(",").map((name) => name.trim()).filter((name) => name.length > 0);
      const grouped = new Map<string, Array<string>>();
      for (const raw of imported) {
        const source = yield* requireValue(
          Option.fromNullishOr(exports.get(raw.replace(/^type /, ""))),
          `Missing Codama export ${raw}`,
        );
        dependencies.push(source);
        const existing = grouped.get(source) ?? [];
        existing.push(raw);
        grouped.set(source, existing);
      }
      const direct = [...grouped.entries()].toSorted(([left], [right]) => Order.String(left, right)).map((
        [source, names],
      ) => `import { ${names.join(", ")} } from "./${source.replace(/\.ts$/, "")}";`).join("\n");
      rewritten = rewritten.replaceAll(block[0], direct);
    }
    return { source: rewritten, dependencies };
  },
);

const selectCodecs = Effect.fn("selectBoundedCodecs")(function*(generatedRoot: string) {
  const { sources, exports } = yield* readCodecs(generatedRoot);
  const pending = ["configParameters.ts", "initializePoolParameters.ts"];
  const selected = new Map<string, string>();
  while (pending.length > 0) {
    const filename = yield* requireValue(Option.fromNullishOr(pending.pop()), "The codec queue must contain an entry");
    if (selected.has(filename)) continue;
    const original = yield* requireValue(
      Option.fromNullishOr(sources.get(filename)),
      `Missing Codama codec ${filename}`,
    );
    if (/\bas\s+(?:const|[A-Z])|\bany\b|!\s*[;,.[]/.test(original)) {
      return yield* new GenerationError({ invariant: `Unexpected cast or assertion in ${filename}` });
    }
    const rewritten = yield* rewriteImports(original, exports);
    pending.push(...rewritten.dependencies);
    selected.set(filename, rewritten.source);
  }
  // A changed dependency closure requires reviewing an intentional pin update.
  if (selected.size !== 12) {
    return yield* new GenerationError({ invariant: "Expected exactly twelve bounded Codama codecs" });
  }
  return selected;
});

type IdlInstruction = typeof Idl.Type.instructions[number];
const renderInstruction = Effect.fn("renderBoundedInstruction")(function*(instruction: IdlInstruction) {
  const argument = yield* requireValue(
    Option.fromNullishOr(instruction.args[0]),
    `Missing argument for ${instruction.name}`,
  );
  if (instruction.args.length !== 1 || instruction.discriminator.length !== 8) {
    return yield* new GenerationError({ invariant: `Unexpected IDL layout for ${instruction.name}` });
  }
  const definition = yield* Schema.decodeUnknownEffect(DefinedArgument)(argument.type);
  const name = pascal(instruction.name);
  const argumentName = camel(argument.name);
  const argumentType = definition.defined.name;
  let source = `\nexport interface ${name}Accounts {\n`;
  for (const account of instruction.accounts) {
    if (Option.isNone(Option.fromNullishOr(account.address)) && account.name !== "program") {
      source += `  readonly ${camel(account.name)}: Address;\n`;
    }
  }
  source += `}\nconst ${camel(instruction.name)}Data = transformEncoder(getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["${argumentName}", get${argumentType}Encoder()],
]), (value: { readonly ${argumentName}: ${argumentType}Args }) => ({ ...value, discriminator: new Uint8Array([${
    instruction.discriminator.join(", ")
  }]) }));
export function get${name}Instruction(accounts: ${name}Accounts, ${argumentName}: ${argumentType}Args): Instruction {
  return {
    programAddress,
    accounts: [
`;
  for (const account of instruction.accounts) {
    const role = `${account.writable === true ? "WRITABLE" : "READONLY"}${account.signer === true ? "_SIGNER" : ""}`;
    const value = Option.match(Option.fromNullishOr(account.address), {
      onSome: (address) => `address("${address}")`,
      onNone: () => account.name === "program" ? "programAddress" : `accounts.${camel(account.name)}`,
    });
    source += `      { address: ${value}, role: AccountRole.${role} },\n`;
  }
  return source + `    ],\n    data: ${camel(instruction.name)}Data.encode({ ${argumentName} }),\n  };\n}\n`;
});

const instructionHeader = (program: string) =>
  `// Generated from the pinned IDL and Codama binary codecs; regenerate, do not hand-edit.
import { AccountRole, address, fixEncoderSize, getBytesEncoder, getStructEncoder, transformEncoder } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { getConfigParametersEncoder } from "./_generated/configParameters";
import type { ConfigParametersArgs } from "./_generated/configParameters";
import { getInitializePoolParametersEncoder } from "./_generated/initializePoolParameters";
import type { InitializePoolParametersArgs } from "./_generated/initializePoolParameters";
export const programAddress = address("${program}");
`;

const generate = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packageRoot = yield* path.fromFileUrl(new URL("../", import.meta.url));
  const generatedRoot = yield* path.fromFileUrl(
    new URL("../../../work/chains-promotion/client/src/generated/types/", import.meta.url),
  );
  const idl = yield* readIdl(packageRoot);
  const codecs = yield* selectCodecs(generatedRoot);
  const instructions = idl.instructions.filter((item) =>
    item.name === "create_config" || item.name === "initialize_virtual_pool_with_spl_token"
  );
  if (instructions.length !== 2) {
    return yield* new GenerationError({ invariant: "Both unsigned construction instructions are required" });
  }
  const rendered = yield* Effect.forEach(instructions, renderInstruction);
  const target = `${packageRoot}src/solana/_generated/`;
  yield* fs.makeDirectory(target, { recursive: true });
  for (const [filename, source] of codecs) yield* fs.writeFileString(`${target}${filename}`, source);
  const index = [...codecs.keys()].toSorted(Order.String).map((filename) =>
    `export * from "./${filename.replace(/\.ts$/, "")}";\n`
  ).join("");
  yield* fs.writeFileString(`${target}index.ts`, index);
  yield* fs.writeFileString(
    `${packageRoot}src/solana/instructions.ts`,
    instructionHeader(idl.address) + rendered.join(""),
  );
  yield* Effect.logInfo("Generated two unsigned instruction builders and twelve pinned Codama codecs");
  return { codecs: codecs.size, instructions: instructions.length };
});

// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This Bun executable owns its filesystem and crypto runtime services.
BunRuntime.runMain(generate.pipe(Effect.provide(BunServices.layer)));
