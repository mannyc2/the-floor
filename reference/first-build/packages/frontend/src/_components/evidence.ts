import type { Note, Proposal, PublicReceipt } from "@floor/contract";
import { Array, Option } from "effect";
import { chainName, money, shortAddress, time, transactionUrl } from "../_lib/format";
import { Message } from "../message";
import type { ViewState } from "../state";
import { button, type H, link, readingRow, tag } from "./ui";

export const noteCard = (model: ViewState, h: H, note: Note) => {
  const author = model.workspace?.agents.find(agent => agent.id === note.agentId)
    ?? model.workspace?.publicAgents.find(agent => agent.id === note.agentId);
  return h.keyed("article")(note.id, [h.Class("note-card")], [
    h.div([h.Class("card-top")], [h.span([h.Class("eyebrow")], [author?.name ?? "An agent"]), tag(h, note.status)]),
    h.p([h.Class("agent-words")], [note.claim]),
    h.div(
      [h.Class("note-sources")],
      Array.map(note.sources, source => h.keyed("div")(source.url, [], [link(h, source.label, source.url)])),
    ),
    h.p([h.Class("mono fine")], [
      note.position.disclosure === "disclosed"
        ? `Position at writing: ${note.position.amount} ${note.position.symbol}`
        : "Position at writing: not disclosed",
    ]),
    ...Array.map(Option.toArray(Option.fromNullOr(note.positionEvidence)), evidence =>
      h.p([h.Class("fine muted")], [
        `${chainName(evidence.chainId)} · account ${shortAddress(evidence.account)} · holdings observed `,
        link(h, `at block ${evidence.blockNumber.toLocaleString()}`, evidence.sourceUrl),
        ` · ${time(evidence.observedAt)}`,
      ])),
    ...Array.map(
      Option.toArray(Option.fromNullOr(note.publicationReason)),
      reason => h.p([h.Class("fine muted")], [reason]),
    ),
    ...Array.map(
      Option.toArray(Option.fromNullOr(note.verification)),
      verification => h.p([h.Class("fine muted")], [verification]),
    ),
    ...Array.map(Option.toArray(Option.fromNullOr(note.assertionEvidence)), evidence =>
      h.p([h.Class("fine muted")], [
        `Checked against ${chainName(evidence.chainId)} ${
          evidence.source === "recording" ? "recorded " : ""
        }block ${evidence.blockNumber.toLocaleString()}.`,
      ])),
    h.small([h.Class("muted")], [time(note.createdAt)]),
  ]);
};

export const receiptCard = (model: ViewState, h: H, receipt: PublicReceipt) => {
  const owner = model.workspace?.agents.find(agent => agent.id === receipt.agentId);
  const thesis = model.workspace?.theses.find(item => item.id === receipt.thesisId);
  const transaction = Option.fromNullishOr(receipt.transactionHash);
  const proposal = Option.fromUndefinedOr(model.workspace?.proposals.find(item => item.id === receipt.proposalId));
  return h.keyed("article")(receipt.id, [h.Class("receipt-card")], [
    h.div([h.Class("card-top")], [h.span([h.Class("eyebrow")], ["ACTION RECEIPT"]), tag(h, receipt.status)]),
    h.h3([], [`${receipt.action} · ${receipt.amount} ${receipt.symbol}`]),
    h.p([h.Class("mono fine")], [receipt.id]),
    h.p([h.Class("fine muted")], [`${chainName(receipt.chainId)} · outcome observed ${time(receipt.updatedAt)}`]),
    ...Array.map(Option.toArray(Option.fromUndefinedOr(thesis)), item => h.p([h.Class("agent-words")], [item.belief])),
    h.p([], [receipt.reason]),
    ...Array.map(Option.toArray(proposal), item => proposalDetails(h, item)),
    h.details([], [
      h.summary([], ["Policy checks"]),
      h.dl(
        [h.Class("readings small")],
        Array.map(receipt.checks, check => readingRow(h, check.rule, check.passed ? "Passed" : "Refused")),
      ),
    ]),
    Option.match(transaction, {
      onNone: () => h.small([h.Class("muted")], ["No transaction hash has been recorded."]),
      onSome: hash =>
        Option.match(transactionUrl(receipt.chainId, hash), {
          onNone: () => h.p([h.Class("mono fine")], [hash]),
          onSome: url => link(h, shortAddress(hash), url),
        }),
    }),
    ...(receipt.status === "pending-review" && Option.isSome(Option.fromUndefinedOr(owner)) && Option.isSome(proposal)
      ? [
        button(h, "Retry the launch gate", Message.Act({ action: { tag: "propose", proposal: proposal.value } }), {
          disabled: model.busy,
        }),
      ]
      : []),
    ...(receipt.status === "awaiting-approval" && Option.isSome(Option.fromUndefinedOr(owner))
        && Option.isSome(proposal)
      ? [h.div([h.Class("approval-controls")], [
        button(h, "Approve", Message.Act({ action: { tag: "approve", id: receipt.id, decision: "approve" } }), {
          disabled: model.busy,
        }),
        button(h, "Decline", Message.Act({ action: { tag: "approve", id: receipt.id, decision: "decline" } }), {
          disabled: model.busy,
        }),
      ])]
      : []),
  ]);
};

const proposalDetails = (h: H, proposal: Proposal) =>
  h.div([h.Class("proposal-details")], [
    h.p([h.Class("eyebrow")], ["EXACT PROPOSED ACTION"]),
    h.dl([h.Class("readings small")], [
      readingRow(h, "Chain", proposal.chainId === 84532 ? "Base Sepolia · 84532" : String(proposal.chainId)),
      readingRow(h, "Protocol / method", `${proposal.protocol} / ${proposal.method}`),
      readingRow(h, "Contract", proposal.contract),
      readingRow(h, "Recipient", proposal.recipient),
      readingRow(
        h,
        "Quoted value",
        proposal.action === "withdraw" ? "Owner transfer · no dollar valuation" : money(proposal.valueUsd),
      ),
      readingRow(h, "Slippage cap", `${proposal.slippageBps} basis points`),
      ...(proposal.action === "launch"
        ? [
          readingRow(h, "Token", `${proposal.launch.name} (${proposal.launch.symbol})`),
          readingRow(h, "Exact supply", proposal.launch.supply),
          readingRow(h, "Agent allocation", `${proposal.launch.allocation} · locked 7 days`),
          readingRow(h, "Graduation threshold (wei)", proposal.launch.graduationThresholdWei),
          readingRow(h, "Virtual liquidity (wei)", proposal.launch.virtualLiquidityWei),
          readingRow(h, "Launch fee (wei)", proposal.launch.launchFeeWei),
          readingRow(h, "Thesis hash", proposal.launch.thesisHash),
        ]
        : []),
    ]),
    h.p([h.Class("fine muted")], [
      "Approval applies to these exact instructions. The signing service checks the current policy and account again before dispatch.",
    ]),
  ]);
