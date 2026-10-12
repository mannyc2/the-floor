import { icon } from "@/_components/icons";
import { button, empty, stat, tag, title } from "@/_components/ui";
import { date, time } from "@/_lib/format";
import { Message } from "@/message";
import type { ViewState } from "@/state";
import type { DesignElection } from "@floor/contract";
import type { DesignSubmission } from "@floor/surfaces";
import { Array, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

const adoptionControl = (model: ViewState, h: HtmlBuilder<Message>, submission: DesignSubmission): Html => {
  if (submission.status !== "accepted") return h.empty;
  const target = Option.fromNullOr(model.atlas).pipe(
    Option.flatMap(atlas =>
      Array.findFirst(atlas.market.markets, market =>
        market.kind === submission.design.kind
        && [market.id, market.token.address.toLowerCase()].includes(submission.design.tokenId.toLowerCase()))
    ),
  );
  return Option.match(target, {
    onNone: () =>
      h.p([h.Class("muted fine")], [
        "This accepted design needs its matching indexed token before holders can adopt it.",
      ]),
    onSome: market =>
      button(
        h,
        `Open a holder vote for ${market.symbol}`,
        Message.Act({
          action: {
            tag: "propose-design-vote",
            designId: submission.id,
            marketId: market.id,
          },
        }),
        { disabled: model.busy || model.workspace?.owner.mode !== "wallet" },
      ),
  });
};
const share = (amount: string, supply: string): string =>
  BigInt(supply) > 0n
    ? `${(Number(BigInt(amount) * 10_000n / BigInt(supply)) / 100).toFixed(2)}%`
    : "—";
const electionCard = (model: ViewState, h: HtmlBuilder<Message>, election: DesignElection): Html => {
  const disabled = model.busy || model.workspace?.owner.mode !== "wallet";
  return h.keyed("article")(election.id, [h.Class("gate-card")], [
    h.div([h.Class("card-top")], [h.h3([], [`${election.symbol} · holder vote`]), tag(h, election.status)]),
    h.p([], [model.workspace?.designs.find(item => item.id === election.designId)?.design.name ?? election.designId]),
    h.p([h.Class("fine muted")], [
      `Weights fixed at Base block ${election.blockNumber.toLocaleString()}. Closes ${date(election.closesAt)} at ${
        time(election.closesAt)
      }.`,
    ]),
    h.div([h.Class("workshop-principles")], [
      stat(h, "SUPPORT", share(election.supportRaw, election.supplyRaw), "of the source supply"),
      stat(h, "OPPOSE", share(election.opposeRaw, election.supplyRaw), "of the source supply"),
      stat(h, "QUORUM", share(election.quorumRaw, election.supplyRaw), "participation required"),
    ]),
    ...(election.status === "open"
      ? [h.div([h.Class("desk-controls")], [
        button(
          h,
          "Support this design",
          Message.Act({ action: { tag: "vote-design", id: election.id, support: true } }),
          { disabled },
        ),
        button(
          h,
          "Keep the current design",
          Message.Act({ action: { tag: "vote-design", id: election.id, support: false } }),
          { disabled },
        ),
        button(
          h,
          "Finalize after voting closes",
          Message.Act({ action: { tag: "finalize-design-vote", id: election.id } }),
          { disabled: model.busy },
        ),
      ])]
      : [h.p([h.Class("fine muted")], [
        election.status === "adopted"
          ? "The adopted form is recorded in the atlas. Earlier replay keeps the form that existed then."
          : "The vote did not reach both quorum and a support majority; the existing form remains.",
      ])]),
  ]);
};

const submissionCard = (model: ViewState, h: HtmlBuilder<Message>, submission: DesignSubmission): Html =>
  h.keyed("article")(submission.id, [h.Class("gate-card")], [
    h.div([h.Class("card-top")], [h.h3([], [submission.design.name]), tag(h, submission.status)]),
    h.div(
      [h.Class("gate-checks")],
      Array.map(submission.checks, (check) =>
        h.keyed("div")(check.name, [h.Class(`gate-check ${check.status}`)], [
          icon(h, check.status === "pass" ? "check" : "flag", 14),
          h.strong([], [check.name]),
          h.span([], [check.detail]),
          tag(h, check.status),
        ])),
    ),
    adoptionControl(model, h, submission),
  ]);

export const community = (model: ViewState, h: HtmlBuilder<Message>): Html => {
  const submissions = model.workspace?.designs ?? [];
  const elections = model.workspace?.designElections ?? [];
  return h.section([h.Class("page community-page")], [
    h.div([h.Class("page-heading-row")], [
      title(
        h,
        "THE EXPRESSION LAYER",
        "Community workshop",
        "Give a machine its own form. The readings still belong to the chain.",
      ),
      button(h, "Submit a design", Message.OpenModal({ modal: "design" }), { class: "button primary", icon: "plus" }),
    ]),
    h.div([h.Class("workshop-principles")], [
      stat(h, "BRASS MEANS DATA", "An honest scale", "Instruments are drawn by the world."),
      stat(h, "DESIGNS ARE DATA", "No arbitrary code", "Drivers read only their own token."),
      stat(h, "THE GATE", "Every check named", "Nothing passes an unavailable review."),
    ]),
    h.p([h.Class("muted")], [
      "Any verified holder can propose an accepted form. Holders have 72 hours to vote; 1% of the snapshot supply must participate, and support must exceed opposition. A wallet's vote can be changed without counting it twice.",
    ]),
    ...(model.workspace?.owner.mode !== "wallet"
      ? [button(h, "Verify wallet for holder voting", Message.ConnectWallet(), { disabled: model.busy })]
      : []),
    ...elections.map(election => electionCard(model, h, election)),
    h.div([h.Class("section-heading")], [
      h.h2([], ["At the gate"]),
      h.span([h.Class("mono muted")], [String(submissions.length)]),
    ]),
    ...(submissions.length > 0 ? Array.map(submissions, (submission) => submissionCard(model, h, submission)) : [
      empty(
        h,
        "The gate is ready",
        "Start with the lily-pond water clock. Remove a required instrument and the gate will explain why it cannot pass.",
        button(h, "Open the lily-pond design", Message.OpenModal({ modal: "design" })),
      ),
    ]),
  ]);
};
