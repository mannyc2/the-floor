import { Schema } from "effect";
import { AgentState } from "./agents";
import { Receipt } from "./economics";
import { AgentId, ChainRef, Checkpoint, WorldId } from "./identifiers";
import { World } from "./world";
import { WorldEventDelivery } from "./world-events";

const publication = { world: WorldId, checkpoint: Checkpoint, agent: AgentId };
export const JoinWorld = Schema.Struct(publication);
export const ChangeWorldState = Schema.Struct({ ...publication, state: AgentState });
export const LandWorldReceipt = Schema.Struct({ ...publication, receipt: Receipt });
export class WorldPublishError extends Schema.TaggedError<WorldPublishError>()("WorldPublishError", {
  operation: Schema.Literals(["join", "state", "receipt", "read"]),
  world: WorldId,
  cause: Schema.Defect(),
}) {}

export const WorldQuery = Schema.Struct({
  world: WorldId,
  chain: ChainRef,
  after: Schema.OptionFromNullOr(Schema.Natural),
});
export const WorldSnapshot = Schema.Struct({
  model: World,
  chain: ChainRef,
  sequence: Schema.Natural,
  checkpoint: Schema.OptionFromNullOr(Checkpoint),
  agents: Schema.Array(Schema.Struct({
    agent: AgentId,
    state: Schema.OptionFromNullOr(AgentState),
    receipt: Schema.OptionFromNullOr(Receipt),
  })),
});
export const WorldFrame = Schema.TaggedUnion({
  Snapshot: { snapshot: WorldSnapshot },
  Delivery: {
    sequence: Schema.Natural,
    delivery: WorldEventDelivery,
    receipt: Schema.OptionFromNullOr(Receipt),
  },
});
