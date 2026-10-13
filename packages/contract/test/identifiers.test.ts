import { expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {
  AccountRef,
  AgentId,
  AssetRef,
  ChainRef,
  Checkpoint,
  Digest,
  Height,
  Timestamp,
  TransactionRef,
} from "../src/identifiers.ts";
import { expectPassed, runTest } from "./_runtime.ts";

const options = { seed: "caip-negative-controls", runs: 256, size: 12 };

test("CAIP envelopes preserve case and reject forbidden separators", () =>
  runTest(Effect.gen(function*() {
    yield* Arbitrary.checkEffect(Arbitrary.schema(ChainRef), (chain) =>
      !Schema.is(ChainRef)(`${chain}:extra`) && !Schema.is(ChainRef)(`${chain} `), options).pipe(
        Effect.tap(expectPassed),
      );
    yield* Arbitrary.checkEffect(Arbitrary.schema(AccountRef), (account) =>
      !Schema.is(AccountRef)(`${account}/extra`) && !Schema.is(AccountRef)(`${account}:extra`), options).pipe(
        Effect.tap(expectPassed),
      );
    yield* Arbitrary.checkEffect(Arbitrary.schema(AssetRef), (asset) =>
      !Schema.is(AssetRef)(`${asset}:extra`) && !Schema.is(AssetRef)(`${asset} `), options).pipe(
        Effect.tap(expectPassed),
      );
    const account = "hedera:mainnet:0.0.1234567890-zbhlt";
    expect<string>(yield* Schema.decodeEffect(AccountRef)(account)).toBe(account);
    const token = "eip155:1/erc721:MixedCaseReference/771769";
    expect<string>(yield* Schema.decodeEffect(AssetRef)(token)).toBe(token);
  })));

test("CAIP lengths are enforced independently at each component", () => {
  for (const chain of ["ab:1", "abcdefghi:1", "eip155:", `eip155:${"a".repeat(33)}`, "EIP155:1"]) {
    expect(Schema.is(ChainRef)(chain)).toBe(false);
  }
  for (const account of ["eip155:1:", `eip155:1:${"a".repeat(129)}`, "name@eip155:1"]) {
    expect(Schema.is(AccountRef)(account)).toBe(false);
  }
  for (
    const asset of [
      "eip155:1/ab:a",
      "eip155:1/abcdefghi:a",
      "eip155:1/token:",
      `eip155:1/token:${"a".repeat(129)}`,
      `eip155:1/token:a/${"1".repeat(79)}`,
      "eip155:1/token:a/1/2",
    ]
  ) expect(Schema.is(AssetRef)(asset)).toBe(false);
  expect(Schema.is(AccountRef)(`chainstd:${"a".repeat(32)}:${"a".repeat(128)}`)).toBe(true);
  expect(Schema.is(AssetRef)(`chainstd:${"a".repeat(32)}/assetstd:${"a".repeat(128)}/${"a".repeat(78)}`)).toBe(true);
});

test("checkpoints require chain, exact height, hash and a valid timestamp", () =>
  runTest(Effect.gen(function*() {
    for (const height of ["-1", "1.2", "01", "1e9", ""]) expect(Schema.is(Height)(height)).toBe(false);
    const largeHeight = "123456789012345678901234567890";
    expect<string>(yield* Schema.decodeEffect(Height)(largeHeight)).toBe(largeHeight);
    const missing = yield* Schema.decodeUnknownEffect(Checkpoint)({ chain: "eip155:1", height: "123", hash: "tx" })
      .pipe(Effect.result);
    expect(missing._tag).toBe("Failure");
    const invalidTime = yield* Schema.decodeEffect(Timestamp)("not-a-time").pipe(Effect.result);
    expect(invalidTime._tag).toBe("Failure");
    const blankHash = yield* Schema.decodeEffect(TransactionRef)({ chain: "eip155:1", hash: "" }).pipe(Effect.result);
    expect(blankHash._tag).toBe("Failure");
  })));

test("identifiers reject every trailing line terminator instead of matching before it", () => {
  for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    expect(Schema.is(ChainRef)(`solana:mainnet${suffix}`)).toBe(false);
    expect(Schema.is(AccountRef)(`solana:mainnet:owner${suffix}`)).toBe(false);
    expect(Schema.is(AssetRef)(`solana:mainnet/token:mint${suffix}`)).toBe(false);
    expect(Schema.is(AgentId)(`agent-1${suffix}`)).toBe(false);
    expect(Schema.is(Digest)(`digest${suffix}`)).toBe(false);
    expect(Schema.is(Height)(`123${suffix}`)).toBe(false);
  }
});
