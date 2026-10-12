import type { PublicReceipt } from "@floor/contract";
import { DateTime, Option, Order } from "effect";
import { AtlasEvidence } from "./types";

export { AtlasEvidence } from "./types";
const occurredBy = (timestamp: string, cutoff: Option.Option<DateTime.Utc>): boolean =>
  Option.exists(
    Option.all({ at: DateTime.make(timestamp), cutoff }),
    ({ at, cutoff: end }) => DateTime.isLessThanOrEqualTo(at, end),
  );

/** Final receipt state belongs to the time the server observed it; chain heights are comparable only on the same chain. */
export const receiptVisibleAt = (
  receipt: PublicReceipt,
  observation: Pick<AtlasEvidence, "observedAt" | "chainId" | "blockNumber">,
): boolean =>
  occurredBy(receipt.updatedAt, DateTime.make(observation.observedAt))
  && (receipt.status !== "confirmed" || receipt.chainId !== observation.chainId
    || receipt.blockNumber <= observation.blockNumber);

/** A replay cannot expose identities or final outcomes that did not exist at its source timestamp. */
export function eligibleEvidence(evidence: AtlasEvidence): AtlasEvidence {
  const cutoff = DateTime.make(evidence.observedAt);
  const agents = evidence.agents.filter(agent => occurredBy(agent.createdAt, cutoff)).toSorted((a, b) =>
    Order.String(a.id, b.id)
  );
  const ids = new Set(agents.map(agent => agent.id));
  return {
    ...evidence,
    agents,
    notes: evidence.notes.filter(note => ids.has(note.agentId) && occurredBy(note.createdAt, cutoff)).toSorted((a, b) =>
      Order.String(a.createdAt, b.createdAt) || Order.String(a.id, b.id)
    ),
    receipts: evidence.receipts.filter(receipt => ids.has(receipt.agentId) && receiptVisibleAt(receipt, evidence))
      .toSorted((a, b) => Order.String(a.updatedAt, b.updatedAt) || Order.String(a.id, b.id)),
  };
}
