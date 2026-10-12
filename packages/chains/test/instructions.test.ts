import { config } from "@floor/chains/testing";
import { getAddressDecoder } from "@solana/kit";
import { expect, test } from "bun:test";
import { Array, Effect, Schema } from "effect";
import idl from "../idl/meteora.json";
import {
  getCreateConfigInstruction,
  getInitializeVirtualPoolWithSplTokenInstruction,
  programAddress,
} from "../src/solana/instructions";
import { expectEqual, runTest } from "./_runtime";

const IdlInstructions = Schema.Array(Schema.Struct({
  name: Schema.String,
  discriminator: Schema.Array(Schema.Int),
  accounts: Schema.Array(Schema.Struct({
    name: Schema.String,
    address: Schema.optionalKey(Schema.String),
    writable: Schema.optionalKey(Schema.Boolean),
    signer: Schema.optionalKey(Schema.Boolean),
  })),
}));
const identity = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));

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
    };
    const addressByName = new Map(Object.entries(accounts));
    const cases = [
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
        const name = account.name.replace(/_([a-z])/g, (_whole: string, letter: string) => letter.toUpperCase());
        const expectedAddress = account.address
          ?? (account.name === "program" ? programAddress : addressByName.get(name));
        expect(expectedAddress).toBeDefined();
        expectEqual(item.actual.accounts?.[index], {
          address: expectedAddress,
          role: (account.writable === true ? 1 : 0) + (account.signer === true ? 2 : 0),
        });
      }
    }
  })));
