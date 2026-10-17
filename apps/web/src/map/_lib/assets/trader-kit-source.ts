import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { Http } from "foldkit";
import { decodeTraderKit, TraderKitError, traderKitFile } from "./trader-kit";

// The build bakes the trader kit and serves it beside the page.
export const loadTraderKit = HttpClient.get(new URL(traderKitFile, document.baseURI).href).pipe(
  Effect.flatMap(response => response.arrayBuffer),
  Effect.mapError(cause => new TraderKitError({ reason: "fetch", cause })),
  Effect.flatMap(decodeTraderKit),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Opening the renderer is the kit fetch's browser composition boundary.
  Effect.provide(Http.layer),
);
