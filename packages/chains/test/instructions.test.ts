import { BunServices } from "@effect/platform-bun";
import { getAddressDecoder } from "@solana/kit";
import { expect, test } from "bun:test";
import { Array, Crypto, Effect, FileSystem, Option, Path, Schema } from "effect";
import { Hex } from "effect/encoding";
import idl from "../idl/meteora.json";
import source from "../idl/source.json";
import {
  getCreateConfigInstruction,
  getInitializeVirtualPoolWithSplTokenInstruction,
  getSwapInstruction,
  programAddress,
} from "../src/solana/instructions";
import { config } from "./_inputs";
import { expectEqual, runTest } from "./_runtime";

const IdlInstructions = Schema.Array(Schema.Struct({
  name: Schema.String,
  discriminator: Schema.Array(Schema.Int),
  accounts: Schema.Array(Schema.Struct({
    name: Schema.String,
    address: Schema.optionalKey(Schema.String),
    writable: Schema.optionalKey(Schema.Boolean),
    signer: Schema.optionalKey(Schema.Boolean),
    optional: Schema.optionalKey(Schema.Boolean),
  })),
}));
const expectedAccountAddress = (
  instruction: string,
  account: typeof IdlInstructions.Type[number]["accounts"][number],
  addressByName: ReadonlyMap<string, string>,
) => {
  const constant = Option.fromNullishOr(account.address);
  if (Option.isSome(constant)) return constant.value;
  if (account.name === "program" || account.optional === true) return programAddress;
  if (instruction === "swap" && (account.name === "token_base_program" || account.name === "token_quote_program")) {
    return "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  }
  const name = account.name.replace(/_([a-z])/g, (_whole: string, letter: string) => letter.toUpperCase());
  return addressByName.get(name);
};
const identity = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));

// The codecs and instruction builders derive from this exact upstream IDL.
test("the pinned Meteora IDL matches its recorded upstream checksum", () =>
  runTest(
    Effect.gen(function*() {
      const file = yield* (yield* Path.Path).fromFileUrl(new URL("../idl/meteora.json", import.meta.url));
      const bytes = yield* (yield* FileSystem.FileSystem).readFile(file);
      expect(Hex.encode(yield* (yield* Crypto.Crypto).digest("SHA-256", bytes))).toBe(source.sha256);
    }).pipe(Effect.provide(BunServices.layer)),
  ));

test("every generated account position, role, constant and discriminator matches the pinned IDL", () =>
  runTest(Effect.gen(function*() {
    const instructions = yield* Schema.decodeEffect(IdlInstructions)(idl.instructions);
    // Every caller address is different so swapped fields cannot hide behind the
    // original fixture's shared payer, creator and recipient identity.
    const accounts = {
      config: identity(17),
      feeClaimer: identity(18),
      leftoverReceiver: identity(19),
      quoteMint: identity(20),
      payer: identity(21),
      eventAuthority: identity(22),
      creator: identity(23),
      baseMint: identity(24),
      pool: identity(25),
      baseVault: identity(26),
      quoteVault: identity(27),
      mintMetadata: identity(28),
      tokenQuoteProgram: identity(29),
      inputTokenAccount: identity(30),
      outputTokenAccount: identity(31),
    };
    const addressByName = new Map(Object.entries(accounts));
    const cases = [
      { name: "swap", actual: getSwapInstruction(accounts, { amountIn: 123n, minimumAmountOut: 456n }) },
      { name: "create_config", actual: getCreateConfigInstruction(accounts, config) },
      {
        name: "initialize_virtual_pool_with_spl_token",
        actual: getInitializeVirtualPoolWithSplTokenInstruction(accounts, {
          name: "Sentinel",
          symbol: "SNT",
          uri: "https://fixture.invalid",
        }),
      },
    ];
    for (const item of cases) {
      const description = yield* Effect.fromOption(
        Array.findFirst(instructions, (candidate) => candidate.name === item.name),
      );
      expectEqual(item.actual.programAddress, idl.address);
      expect(item.actual.accounts).toHaveLength(description.accounts.length);
      expectEqual([...new Uint8Array(item.actual.data ?? []).slice(0, 8)], description.discriminator);
      for (const [index, account] of description.accounts.entries()) {
        const expectedAddress = expectedAccountAddress(item.name, account, addressByName);
        expect(expectedAddress).toBeDefined();
        expectEqual(item.actual.accounts?.[index], {
          address: expectedAddress,
          role: account.optional === true ? 0 : (account.writable === true ? 1 : 0) + (account.signer === true ? 2 : 0),
        });
      }
    }
  })));
