import { emblem } from "@/_components/icons";
import type { H } from "@/_components/ui";
import { chainName, time } from "@/_lib/format";
import { viewEvidence } from "@/_lib/market-evidence";
import { Message } from "@/message";
import type { ViewState } from "@/state";
import type { MarketView } from "@floor/markets/schema";
import { Array, DateTime, Option, Record } from "effect";

/** A stamp records when an outcome became known; testnet receipts never imply a trade changed the mainnet price line. */
export const tideStamps = (model: ViewState, h: H, market: MarketView) => {
  const bounds = Option.all({
    first: Array.head(market.history).pipe(Option.flatMap(point => DateTime.make(point.timestamp))),
    last: Array.last(market.history).pipe(Option.flatMap(point => DateTime.make(point.timestamp))),
    evidence: viewEvidence(model),
  });
  return Option.match(bounds, {
    onNone: () => h.empty,
    onSome: ({ first, last, evidence }) => {
      const start = DateTime.toEpochMillis(first);
      const end = DateTime.toEpochMillis(last);
      if (end <= start) return h.empty;
      const stamps = evidence.receipts.flatMap(receipt => {
        if (receipt.marketId !== market.id || receipt.status !== "confirmed") return [];
        return Option.toArray(
          Option.all({
            author: Array.findFirst(evidence.agents, agent => agent.id === receipt.agentId),
            observed: DateTime.make(receipt.updatedAt),
          }).pipe(
            Option.filter(({ observed }) => DateTime.between(observed, { minimum: first, maximum: last })),
            Option.map(({ author, observed }) => ({
              author,
              receipt,
              bucket: Math.round((DateTime.toEpochMillis(observed) - start) / (end - start) * 10),
            })),
          ),
        );
      });
      const groups = Array.groupBy(stamps, stamp => String(stamp.bucket));
      return h.div(
        [h.Class("tide-stamps"), h.AriaLabel("Confirmed action receipts")],
        Array.map(Record.toEntries(groups), ([bucket, group]) => {
          const firstStamp = group[0];
          const label = `${firstStamp.author.name} · ${chainName(firstStamp.receipt.chainId)} · ${
            time(firstStamp.receipt.updatedAt)
          }${group.length > 1 ? ` · ${group.length} receipts` : ""}`;
          return h.keyed("button")(bucket, [
            h.Type("button"),
            h.Class("tide-stamp"),
            h.Style({ left: `${Math.min(97, Math.max(3, Number(bucket) * 10))}%` }),
            h.Title(label),
            h.AriaLabel(`View receipt: ${label}`),
            h.OnClick(Message.ChangedTab({ tab: "receipts" })),
          ], [
            emblem(h, firstStamp.author.emblem, 18),
            ...(group.length > 1 ? [h.small([], [String(group.length)])] : []),
          ]);
        }),
      );
    },
  });
};
