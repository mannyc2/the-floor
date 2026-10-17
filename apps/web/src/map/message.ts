import { WorldFrame } from "@floor/contract/world-stream";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { Camera, EntityId, Turn } from "./model";
export const WorldConnection = Schema.Literals(["connecting", "live", "reconnecting"]);
export const Message = defineMessageUnion({
  SucceededMountMap: {
    generation: Schema.Int,
    renderer: Schema.String,
    snapshotRevision: Schema.optionalKey(Schema.Int),
  },
  FailedMap: { reason: Schema.String },
  AppliedFrame: { generation: Schema.Int, sequence: Schema.Int },
  SelectedEntity: { entity: Schema.Option(EntityId) },
  RestedCamera: { camera: Camera, history: Schema.Boolean },
  ClickedRotate: { direction: Turn },
  ClickedFloor: { floor: Schema.Int },
  ClickedFollow: { entity: EntityId },
  ClickedTheme: {},
  ToggledDesks: {},
  ChangedDeskQuery: { query: Schema.String },
  ReceivedWorldFrame: { frame: WorldFrame },
  ChangedWorldConnection: { connection: WorldConnection },
  AppliedWorldSnapshot: { revision: Schema.Natural },
  CompletedPresent: {},
  CompletedFlight: {},
  CompletedUrl: {},
});
export type Message = typeof Message.Type;
