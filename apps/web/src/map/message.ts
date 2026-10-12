import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { Camera, EntityId } from "./model";
export const Message = defineMessageUnion({
  SucceededMountMap: { generation: Schema.Int, renderer: Schema.String },
  FailedMap: { reason: Schema.String },
  AppliedFrame: { generation: Schema.Int, sequence: Schema.Int },
  SelectedEntity: { entity: Schema.Option(EntityId) },
  RestedCamera: { camera: Camera, history: Schema.Boolean },
  ClickedVisibility: {},
  ClickedReorder: {},
  ClickedTheme: {},
  ClickedFrameA: {},
  ClickedFrameB: {},
  ClickedFlight: {},
  ClickedFollow: {},
  CompletedPresent: {},
  CompletedFlight: {},
  CompletedUrl: {},
});
export type Message = typeof Message.Type;
