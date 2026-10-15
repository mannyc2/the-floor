import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { buildAtlas } from "./atlas/manifest";

buildAtlas().pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
