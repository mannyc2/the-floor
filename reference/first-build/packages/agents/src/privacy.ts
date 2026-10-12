import { type Agent, type Note, type PublicAgent, publicAgent, type Receipt } from "@floor/contract";
import { Array, Option } from "effect";

export function visibleAgent(
  agent: Agent,
  viewer: Option.Option<string> = Option.none(),
): Option.Option<Agent | PublicAgent> {
  if (Option.contains(viewer, agent.owner)) return Option.some(agent);
  if (agent.visibility === "private") return Option.none();
  return Option.some(publicAgent(agent));
}
export function visibleNotes(
  notes: readonly Note[],
  agents: readonly Agent[],
  viewer: Option.Option<string> = Option.none(),
): readonly Note[] {
  return notes.filter(note =>
    Option.exists(
      Array.findFirst(agents, agent => agent.id === note.agentId),
      agent => Option.contains(viewer, agent.owner) || (agent.visibility === "public" && note.visibility === "public"),
    )
  );
}
export function visibleReceipt(
  receipt: Receipt,
  agent: Option.Option<Agent>,
  viewer: Option.Option<string> = Option.none(),
) {
  if (Option.exists(agent, value => Option.contains(viewer, value.owner))) return receipt;
  if (Option.exists(agent, value => value.visibility === "private")) {
    return {
      id: receipt.id,
      action: receipt.action,
      status: receipt.status,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
    };
  }
  const { owner: _owner, ...publicReceipt } = receipt;
  return publicReceipt;
}
