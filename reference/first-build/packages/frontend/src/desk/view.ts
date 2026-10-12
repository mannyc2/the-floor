import { noteCard, receiptCard } from "@/_components/evidence";
import { emblem, icon } from "@/_components/icons";
import { button, empty, iconButton, link, readingRow, tag, title } from "@/_components/ui";
import { money, safeUrl } from "@/_lib/format";
import { Message } from "@/message";
import type { ViewState } from "@/state";
import { type Agent, type PublicAgent, publicAgent } from "@floor/contract";
import type { AgentActivity } from "@floor/surfaces";
import { Array, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

type Desk = { readonly kind: "owned"; readonly agent: Agent } | {
  readonly kind: "public";
  readonly agent: PublicAgent;
};
const ownerSelection = (agent: Agent): Desk => ({ kind: "owned", agent });
const publicSelection = (agent: PublicAgent): Desk => ({ kind: "public", agent });
const selectDesk = (model: ViewState): Option.Option<Desk> => {
  const owned = model.workspace?.agents ?? [];
  const published = model.workspace?.publicAgents ?? [];
  return Array.findFirst(owned, (agent) => agent.id === model.selectedAgent).pipe(
    Option.map(ownerSelection),
    Option.orElse(() =>
      Array.findFirst(published, (agent) => agent.id === model.selectedAgent).pipe(Option.map(publicSelection))
    ),
    Option.orElse(() => Array.head(owned).pipe(Option.map(ownerSelection))),
    Option.orElse(() => Array.head(published).pipe(Option.map(publicSelection))),
  );
};

const agentTabs = (model: ViewState, h: HtmlBuilder<Message>, selected: Option.Option<Desk>): Html => {
  const identities = Array.dedupeWith([
    ...Array.map(model.workspace?.agents ?? [], publicAgent),
    ...model.workspace?.publicAgents ?? [],
  ], (left: PublicAgent, right: PublicAgent) => left.id === right.id);
  if (identities.length === 0) return h.empty;
  return h.div(
    [h.Class("agent-tabs")],
    Array.map(identities, (agent) => {
      const active = Option.exists(selected, (desk) => desk.agent.id === agent.id);
      return h.keyed("button")(agent.id, [
        h.Type("button"),
        h.Class(`agent-tab${active ? " active" : ""}`),
        h.AriaPressed(String(active)),
        h.OnClick(Message.SelectedAgent({ id: agent.id })),
      ], [emblem(h, agent.emblem), agent.name, tag(h, agent.state)]);
    }),
  );
};

export const desk = (model: ViewState, h: HtmlBuilder<Message>): Html => {
  const selected = selectDesk(model);
  return h.section([h.Class("page desk-page")], [
    h.div([h.Class("page-heading-row")], [
      title(h, "THE INHABITANTS", "Agents at work", "A mandate, a notebook, and a receipt for every decision."),
      button(h, "Open a new desk", Message.OpenModal({ modal: "agent" }), { icon: "plus", class: "button primary" }),
    ]),
    agentTabs(model, h, selected),
    Option.match(selected, {
      onNone: () =>
        empty(
          h,
          "Your first desk is waiting",
          "Give an agent a mandate, an emblem, and a daily budget. Its notes, decisions, and receipts will have a home here.",
          button(h, "Set up your first agent", Message.OpenModal({ modal: "agent" }), {
            class: "button primary",
            icon: "plus",
          }),
        ),
      onSome: (selection) =>
        selection.kind === "owned" ? ownerDesk(model, h, selection.agent) : publicDesk(model, h, selection.agent),
    }),
  ]);
};

const deskBanner = (h: HtmlBuilder<Message>, agent: Agent | PublicAgent, controls: Html, status: string): Html =>
  h.div([h.Class("desk-banner")], [
    emblem(h, agent.emblem, 48),
    h.div([], [
      h.p([h.Class("eyebrow")], ["BASE · HARBOUR HALL"]),
      h.h2([], [`${agent.name}’s desk`]),
      h.p([h.Class("muted")], [status]),
    ]),
    controls,
  ]);

const researchWindow = (model: ViewState, h: HtmlBuilder<Message>, agent: Agent): Html => {
  const activity = Array.findFirst(model.workspace?.activity ?? [], (item) => item.agentId === agent.id);
  const browsing = Option.flatMap(
    activity,
    (item) => Option.fromNullishOr(item.browserUrl).pipe(Option.map((url) => ({ activity: item, url }))),
  );
  const connected = (model.workspace?.services ?? []).some((service) =>
    service.name === "Research browser" && service.configured
  );
  return h.div([h.Class("desk-screen")], [
    h.div([h.Class("card-top")], [
      h.span([h.Class("eyebrow")], ["THE RESEARCH WINDOW"]),
      tag(h, Option.exists(activity, (item) => item.untrusted) ? "Untrusted page" : "Read-only"),
    ]),
    Option.match(browsing, {
      onNone: () =>
        h.div([h.Class("screen-idle")], [
          icon(h, "research", 36),
          h.p([], ["A browser, with a purpose."]),
          h.small([], [
            connected
              ? "Ready for the next research cycle."
              : "Connect a research browser in your service configuration.",
          ]),
        ]),
      onSome: ({ activity: item, url }) =>
        h.div([], [h.p([h.Class("mono fine")], [url]), browserScreen(h, agent.name, item), h.p([], [item.message])]),
    }),
  ]);
};

const browserScreen = (h: HtmlBuilder<Message>, name: string, activity: AgentActivity): Html =>
  Option.match(
    Option.fromNullishOr(activity.liveViewUrl).pipe(Option.filter((url) => url.startsWith("https://"))),
    {
      onNone: () => h.empty,
      onSome: (url) => h.iframe([h.Src(safeUrl(url)), h.Title(`${name} browser live view`), h.Class("browser-screen")]),
    },
  );

const notebooks = (model: ViewState, h: HtmlBuilder<Message>, agent: Agent): Html => {
  const notes = (model.workspace?.notes ?? []).filter((note) => note.agentId === agent.id);
  const theses = (model.workspace?.theses ?? []).filter((thesis) => thesis.agentId === agent.id);
  return h.div([h.Class("research-columns")], [
    h.section([], [
      h.div([h.Class("section-heading")], [
        h.h3([], ["The corkboard"]),
        h.span([h.Class("mono muted")], [`${notes.length} pins`]),
      ]),
      ...(notes.length > 0
        ? Array.map(notes, (note) => noteCard(model, h, note))
        : [h.p([h.Class("muted")], ["Sourced observations will be pinned here."])]),
    ]),
    h.section([], [
      h.div([h.Class("section-heading")], [
        h.h3([], ["The notebook"]),
        h.span([h.Class("mono muted")], [`${theses.length} theses`]),
      ]),
      ...(theses.length > 0
        ? Array.map(theses, (thesis) =>
          h.keyed("article")(thesis.id, [h.Class("note-card")], [
            h.p([h.Class("agent-words")], [thesis.belief]),
            h.small([], [`What would change it: ${thesis.invalidation}`]),
          ]))
        : [h.p([h.Class("muted")], ["A thesis states a belief and what would change it."])]),
    ]),
  ]);
};

const policyPanel = (h: HtmlBuilder<Message>, agent: Agent): Html => {
  const spent = agent.budget.dailyUsd > 0 ? Math.min(100, agent.budget.spentUsd / agent.budget.dailyUsd * 100) : 0;
  return h.aside([h.Class("desk-policy")], [
    h.p([h.Class("eyebrow")], ["DAILY INFERENCE"]),
    h.strong([h.Class("budget-figure mono")], [`${money(agent.budget.spentUsd)} / ${money(agent.budget.dailyUsd)}`]),
    h.div([h.Class("budget-track")], [h.div([h.Style({ width: `${spent}%` }), h.AriaHidden(true)])]),
    h.p([h.Class("fine muted")], ["When the budget is spent, the agent sleeps."]),
    h.hr([]),
    h.h3([], ["The mandate"]),
    h.p([h.Class("agent-words mandate")], [agent.mandate]),
    tag(h, agent.publishMandate ? "Published" : "Private to you"),
    h.hr([]),
    h.h3([], ["Confirmed limits"]),
    h.dl([h.Class("readings")], [
      readingRow(h, "Maximum trade", money(agent.policy.maxTradeUsd)),
      readingRow(h, "Maximum position", `${agent.policy.maxPositionPercent}%`),
      readingRow(h, "Ask above", money(agent.policy.approvalThresholdUsd)),
      readingRow(h, "Daily loss limit", money(agent.policy.dailyLossLimitUsd)),
      readingRow(h, "Slippage cap", `${agent.policy.maxSlippageBps} bps`),
      readingRow(h, "Launches", agent.policy.launchAllowed ? "Permitted" : "Not permitted"),
    ]),
    h.p([h.Class("fine muted")], [
      "Limits are enforced outside the model. Trades require a separately connected scoped account.",
    ]),
    button(h, "Edit confirmed limits", Message.OpenModal({ modal: "policy" }), {
      class: "wide-button",
      icon: "settings",
    }),
    h.hr([]),
    h.h3([], ["Smart account"]),
    h.p([h.Class("mono fine")], [agent.walletAddress ?? "Not connected"]),
    h.small([h.Class("muted")], ["Funds stay in an account you own. Only testnet transactions are supported."]),
    button(h, "Withdraw ETH to owner", Message.OpenModal({ modal: "withdraw" }), {
      class: "wide-button",
      disabled: Option.isNone(Option.fromNullOr(agent.walletAddress)),
    }),
  ]);
};

const ownerDesk = (model: ViewState, h: HtmlBuilder<Message>, agent: Agent): Html => {
  const receipts = (model.workspace?.receipts ?? []).filter((receipt) => receipt.agentId === agent.id);
  const controls = h.div([h.Class("desk-controls")], [
    button(h, "Run research", Message.Act({ action: { tag: "run-agent", id: agent.id } }), {
      icon: "play",
      disabled: model.busy || agent.paused,
      class: "button primary",
    }),
    iconButton(
      h,
      agent.paused ? "Resume agent" : "Pause agent",
      agent.paused ? "play" : "pause",
      Message.Act({
        action: { tag: "pause-agent", id: agent.id, paused: !agent.paused },
      }),
    ),
    iconButton(h, "Edit mandate and limits", "settings", Message.OpenModal({ modal: "policy" })),
  ]);
  return h.div([h.Class("desk-grid")], [
    h.div([h.Class("desk-main")], [
      deskBanner(
        h,
        agent,
        controls,
        agent.paused
          ? "Paused. Research and signing stay off until you resume."
          : agent.state === "asleep"
          ? "Ready for its next assignment."
          : `${agent.name} is ${agent.state}.`,
      ),
      researchWindow(model, h, agent),
      ...(agent.visibility === "public"
        ? [link(h, "Share this public desk", `${model.origin}/agents/${encodeURIComponent(agent.id)}`)]
        : []),
      notebooks(model, h, agent),
      h.section([h.Class("desk-ledger")], [
        h.div([h.Class("section-heading")], [
          h.h3([], ["The ledger"]),
          h.span([h.Class("mono muted")], [`${receipts.length} receipts`]),
        ]),
        ...(receipts.length > 0
          ? Array.map(receipts, (receipt) => receiptCard(model, h, receipt))
          : [
            h.p([h.Class("muted")], ["No proposals yet. Completed actions and refusals both belong in this record."]),
          ]),
      ]),
    ]),
    policyPanel(h, agent),
  ]);
};

/** Public desks have a distinct type, so owner-only fields cannot enter their view by accident. */
const publicDesk = (model: ViewState, h: HtmlBuilder<Message>, agent: PublicAgent): Html => {
  const notes = (model.workspace?.notes ?? []).filter((note) =>
    note.agentId === agent.id && note.visibility === "public"
  );
  return h.div([h.Class("desk-grid")], [
    h.div([h.Class("desk-main")], [
      deskBanner(
        h,
        agent,
        tag(h, "Public desk"),
        agent.state === "asleep"
          ? "The lamp is off. The record remains."
          : `${agent.name} is ${agent.state}.`,
      ),
      link(h, "Share this public desk", `${model.origin}/agents/${encodeURIComponent(agent.id)}`),
      h.section([h.Class("desk-ledger")], [
        h.div([h.Class("section-heading")], [
          h.h3([], ["The public corkboard"]),
          h.span([h.Class("mono muted")], [`${notes.length} pins`]),
        ]),
        ...(notes.length > 0
          ? Array.map(notes, (note) => noteCard(model, h, note))
          : [h.p([h.Class("muted")], ["This agent has not published any notes."])]),
      ]),
    ]),
    h.aside([h.Class("desk-policy")], [
      h.p([h.Class("eyebrow")], ["PUBLISHED MANDATE"]),
      h.hr([]),
      Option.match(agent.publishedMandate, {
        onNone: () => h.p([h.Class("muted")], ["This agent has not published its mandate."]),
        onSome: (mandate) => h.p([h.Class("agent-words")], [mandate]),
      }),
    ]),
  ]);
};
