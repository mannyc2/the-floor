import { BunServices } from "@effect/platform-bun";
import { rpcResult, SolanaRpc } from "@floor/chains/solana/rpc";
import { Effect, Schedule, Schema } from "effect";
import { ChildProcess } from "effect/process";

export class ForkRuntimeError
  extends Schema.TaggedError<ForkRuntimeError>()("ForkRuntimeError", { cause: Schema.Defect() })
{}

export const forkEndpoint = "http://127.0.0.1:18899";
export const startSurfpool = Effect.gen(function*() {
  yield* ChildProcess.make("work/fork/surfpool", [
    "start",
    "--offline",
    "--snapshot",
    "work/fork/snapshot.json",
    "--no-tui",
    "--no-studio",
    "--no-deploy",
    "--port",
    "18899",
    "--ws-port",
    "18900",
    "--airdrop-amount",
    "0",
    "--log-path",
    "work/fork/logs",
  ], { stdout: "ignore", stderr: "inherit", forceKillAfter: "3 seconds" });
  const ready = SolanaRpc.use(
    Effect.fn("fork.ready")(function*(rpc) {
      yield* rpcResult(rpc, Schema.String, "getHealth", []);
      const slot = yield* rpcResult(rpc, Schema.Natural, "getSlot", [{ commitment: "confirmed" }]);
      // Health becomes ready before Surfpool's first local slot is confirmed.
      // Waiting for its block keeps account checkpoints out of the remote past.
      yield* rpcResult(rpc, Schema.Struct({ blockhash: Schema.String }), "getBlock", [slot, {
        commitment: "confirmed",
        transactionDetails: "none",
        rewards: false,
        maxSupportedTransactionVersion: 0,
      }]);
    }),
  ).pipe(Effect.provide(SolanaRpc.layer(forkEndpoint)));
  yield* ready.pipe(Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 }));
}).pipe(Effect.mapError(cause => new ForkRuntimeError({ cause })), Effect.provide(BunServices.layer));
