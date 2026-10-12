import { publicAgent } from "@floor/contract";
import { eligibleEvidence } from "@floor/renderer/evidence";
import type { AtlasSnapshot, Workspace } from "@floor/surfaces";
import { Array, Option } from "effect";
import type { ViewState } from "../state";

/** The server controls visibility; this second projection removes private owner fields before drawing. */
export const workspaceEvidence = (workspace: Workspace, atlas: AtlasSnapshot) =>
  eligibleEvidence({
    agents: Array.dedupeWith([...workspace.agents.map(publicAgent), ...workspace.publicAgents], (left, right) =>
      left.id === right.id),
    receipts: workspace.receipts,
    notes: workspace.notes,
    observedAt: atlas.market.blockTimestamp,
    chainId: atlas.market.chainId,
    blockNumber: atlas.market.blockNumber,
  });

export const viewEvidence = (model: ViewState) =>
  Option.flatMap(
    Option.fromNullOr(model.atlas),
    atlas => Option.map(Option.fromNullOr(model.workspace), workspace => workspaceEvidence(workspace, atlas)),
  );
