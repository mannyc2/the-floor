import { type Receipt, ReceiptCause } from "@floor/contract/economics";
import type { WorldSnapshot } from "@floor/contract/world-stream";
import { BigDecimal, DateTime, Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Message } from "../message";

type Agent = (typeof WorldSnapshot.Type)["agents"][number];

const receiptView = (receipt: Receipt, h: HtmlBuilder<Message>) => {
  const transaction = receipt._tag === "SettledReceipt"
    ? Option.some(receipt.transaction)
    : receipt._tag === "UnknownReceipt"
    ? receipt.transaction
    : Option.none();
  const policy = receipt._tag === "RefusedReceipt"
    ? receipt.policy._tag === "Unconfirmed" ? Option.none() : Option.some(receipt.policy.policy)
    : Option.some(receipt.policy);
  const outcome = receipt._tag === "SettledReceipt"
    ? `Settled · ${receipt.result}`
    : receipt._tag === "RefusedReceipt"
    ? "Refused"
    : "Outcome unknown";
  return h.section([h.AriaLabel("Last receipt"), h.Class("receipt")], [
    h.h3([], ["Last receipt"]),
    h.p([h.DataAttribute("receipt-outcome", receipt._tag)], [outcome]),
    h.dl([], [
      h.dt([], ["Receipt"]),
      h.dd([], [receipt.id]),
      h.dt([], ["Action"]),
      h.dd([], [
        receipt.action._tag === "Launch"
          ? "Launch"
          : `${receipt.action._tag} · $${BigDecimal.format(receipt.action.dollars)}`,
      ]),
      ...(receipt.action._tag === "Swap"
        ? [
          h.dt([], ["Sell"]),
          h.dd([], [receipt.action.sell]),
          h.dt([], ["Buy"]),
          h.dd([], [receipt.action.buy]),
        ]
        : []),
      h.dt([], ["Recorded"]),
      h.dd([], [DateTime.formatIso(receipt.recordedAt)]),
      h.dt([], ["Chain"]),
      h.dd([], [receipt.action.chain]),
      h.dt([], ["Transaction"]),
      h.dd([h.DataAttribute("transaction", Option.getOrElse(Option.map(transaction, value => value.hash), () => ""))], [
        Option.getOrElse(Option.map(transaction, value => value.hash), () => "No transaction reported"),
      ]),
      ...(receipt._tag === "SettledReceipt"
        ? [h.dt([], ["Checkpoint"]), h.dd([], [receipt.checkpoint.height])]
        : [
          h.dt([], ["Reason"]),
          h.dd([], [receipt._tag === "RefusedReceipt" ? receipt.refusal.detail : receipt.reason]),
        ]),
      h.dt([], ["Authority"]),
      h.dd([], [
        Option.match(policy, {
          onNone: () => "Policy unconfirmed",
          onSome: value => value._tag === "ForkPolicy" ? `Local fork · ${value.genesisHash}` : "Confirmed owner policy",
        }),
      ]),
    ]),
    h.h3([], ["Recorded sources"]),
    ...receipt.causes.map(cause =>
      h.p([], [ReceiptCause.match(cause, {
        AgentIntent: value => `Agent ${value.agent} · intent ${value.intent}`,
        Note: value => `Note ${value.item} · version ${value.version}`,
        Thesis: value => `Thesis ${value.item} · version ${value.version}`,
        BoardPost: value => `Board post ${value.post}`,
        OwnerRequest: value => `Owner ${value.owner} · request ${value.request}`,
      })])
    ),
  ]);
};

export const deskDrawer = (
  { agent, location, follow }: {
    readonly agent: Agent;
    readonly location: string;
    // Absent while the agent stands nowhere the layout positions.
    readonly follow: Option.Option<Message>;
  },
  h: HtmlBuilder<Message>,
) =>
  h.aside([h.Class("desk-drawer"), h.AriaLabel("Agent desk")], [
    h.header([h.Class("drawer-head")], [
      h.p([h.Class("drawer-kicker")], ["Agent desk"]),
      h.button([h.Class("chrome-link drawer-close"), h.OnClick(Message.SelectedEntity({ entity: Option.none() }))], [
        "Close desk",
      ]),
      h.h2([], [agent.agent]),
    ]),
    h.dl([h.Class("drawer-facts")], [
      h.dt([], ["State"]),
      h.dd([h.DataAttribute("agent-state", Option.getOrElse(agent.state, () => "unreported"))], [
        Option.getOrElse(agent.state, () => "State not reported"),
      ]),
      h.dt([], ["Where"]),
      h.dd([h.DataAttribute("agent-location", location)], [location]),
    ]),
    h.button(
      [
        h.Class("chrome-button chrome-text drawer-follow"),
        ...Option.match(follow, {
          onNone: () => [h.Disabled(true)],
          onSome: message => [h.OnClick(message)],
        }),
      ],
      ["Follow agent"],
    ),
    Option.match(agent.receipt, {
      onNone: () => h.p([h.Class("drawer-empty")], ["No receipt recorded yet."]),
      onSome: receipt => receiptView(receipt, h),
    }),
  ]);
