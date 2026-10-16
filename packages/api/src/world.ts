import { WorldEvent } from "@floor/contract/world-events";
import {
  ChangeWorldState,
  JoinWorld,
  LandWorldReceipt,
  MoveInWorld,
  WorldFrame,
  WorldPublishError,
  WorldQuery,
} from "@floor/contract/world-stream";
import { Context, Effect, Stream } from "effect";

export {
  ChangeWorldState,
  JoinWorld,
  LandWorldReceipt,
  MoveInWorld,
  WorldFrame,
  WorldPublishError,
  WorldQuery,
  WorldSnapshot,
} from "@floor/contract/world-stream";

export class WorldPublisher extends Context.Service<WorldPublisher, {
  readonly join: (input: typeof JoinWorld.Type) => Effect.Effect<WorldEvent, WorldPublishError>;
  readonly state: (input: typeof ChangeWorldState.Type) => Effect.Effect<WorldEvent, WorldPublishError>;
  readonly receipt: (input: typeof LandWorldReceipt.Type) => Effect.Effect<WorldEvent, WorldPublishError>;
  readonly move: (input: typeof MoveInWorld.Type) => Effect.Effect<WorldEvent, WorldPublishError>;
}>()("floor/WorldPublisher") {}

export class WorldReader extends Context.Service<WorldReader, {
  readonly watch: (input: typeof WorldQuery.Type) => Stream.Stream<typeof WorldFrame.Type, WorldPublishError>;
}>()("floor/WorldReader") {}
