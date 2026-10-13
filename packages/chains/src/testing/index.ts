import { getAddressDecoder } from "@solana/kit";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import type { DopplerLaunchInput } from "../evm";
import { MeteoraLaunch, QuoteAccountRpcReply } from "../solana";
import type { MeteoraLaunchInput } from "../solana";
import { config } from "./meteora-config";

export { config } from "./meteora-config";

// These are replay inputs from kit-construction/002, not live provider data.
const identity = (byte: number) => getAddressDecoder().decode(new Uint8Array(32).fill(byte));
export const meteoraInput: MeteoraLaunchInput = {
  rpcEndpoint: "https://fixture.invalid/rpc",
  payer: identity(1),
  creator: identity(1),
  feeClaimer: identity(1),
  leftoverReceiver: identity(1),
  configAddress: identity(2),
  baseMint: identity(3),
  quoteMint: "So11111111111111111111111111111111111111112",
  config,
  metadata: { name: "Spike", symbol: "SPK", uri: "https://example.invalid/spike" },
  blockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 0n,
};

export const dopplerInput: DopplerLaunchInput = {
  chainId: 8453,
  owner: "0x1111111111111111111111111111111111111111",
  salt: "0x1111111111111111111111111111111111111111111111111111111111111111",
  token: { name: "Spike", symbol: "SPK", tokenURI: "https://example.invalid/spike" },
  initialSupply: 1_000_000n * 10n ** 18n,
  numTokensToSell: 900_000n * 10n ** 18n,
  numeraire: "0x4200000000000000000000000000000000000006",
  fee: 3000,
  tickSpacing: 60,
  curves: [{ tickLower: 0, tickUpper: 240000, numPositions: 10, shares: 10n ** 18n }],
};

export const quoteRpcLayer = (options: { readonly slot: number; readonly owner: string; readonly status?: number }) =>
  Layer.unwrap(Effect.gen(function*() {
    const json = yield* Schema.encodeEffect(Schema.fromJsonString(QuoteAccountRpcReply))({
      jsonrpc: "2.0",
      id: 1,
      result: { context: { slot: options.slot }, value: { owner: options.owner } },
    });
    const replayFetch = Object.assign(() =>
      // oxlint-disable-next-line effect/noNewPromise -- The test Fetch callback implements the browser Promise contract without making a network request.
      Promise.resolve(
        new Response(json, { status: options.status ?? 200, headers: { "content-type": "application/json" } }),
      ), { preconnect: () => {/* Replay preconnection must never open a socket. */} });
    return MeteoraLaunch.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, replayFetch)));
  }));

export const meteoraRpcLayer = quoteRpcLayer({ slot: 0, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" });
