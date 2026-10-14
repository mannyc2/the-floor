import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { buildAtlas } from "./atlas/manifest";

buildAtlas().pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The generator entry owns filesystem and cryptographic platform services.
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
