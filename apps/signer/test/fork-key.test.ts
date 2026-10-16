import { SignerError } from "@floor/chains/signer";
import { SolanaRpc } from "@floor/chains/solana/rpc";
import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer, Ref, Schema } from "effect";
import { ForkKey } from "../src/fork-key";
import { runTest } from "./_runtime";

const remoteGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
describe("fork-only key authority", () => {
  test("public RPCs and known public genesis configurations fail before reading or importing a key", () =>
    runTest(Effect.gen(function*() {
      const reads = yield* Ref.make(0);
      const rpc = Layer.succeed(
        SolanaRpc,
        SolanaRpc.of({ request: () => Ref.update(reads, count => count + 1).pipe(Effect.as(remoteGenesis)) }),
      );
      for (
        const configuration of [
          { endpoint: "https://api.mainnet-beta.solana.com", genesisHash: "local-only" },
          { endpoint: "http://127.0.0.1:18899", genesisHash: remoteGenesis },
        ]
      ) {
        const exit = yield* ForkKey.pipe(
          Effect.provide(ForkKey.layer({ ...configuration, secretKey: new Uint8Array() }).pipe(Layer.provide(rpc))),
          Effect.exit,
        );
        expect(Exit.isFailure(exit)).toBe(true);
      }
      expect(yield* Ref.get(reads)).toBe(0);
    })));
  test("a loopback server reporting another genesis fails before importing the private key", () =>
    runTest(Effect.gen(function*() {
      const rpc = Layer.succeed(SolanaRpc, SolanaRpc.of({ request: () => Effect.succeed(remoteGenesis) }));
      const error = yield* ForkKey.pipe(
        Effect.provide(
          ForkKey.layer({
            endpoint: "http://127.0.0.1:18899",
            genesisHash: "expected-local-genesis",
            secretKey: new Uint8Array(),
          }).pipe(Layer.provide(rpc)),
        ),
        Effect.flip,
      );
      expect(error.operation).toBe("fork.verify");
      expect(Schema.is(SignerError)(error.cause)).toBe(true);
      if (Schema.is(SignerError)(error.cause)) expect(error.cause.operation).toBe("fork.genesis");
    })));
});
