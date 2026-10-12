import { defaultPolicy, Design, Policy } from "@floor/contract";
import { lilyPondDesign } from "@floor/gate";
import { Action } from "@floor/surfaces";
import { Result, Schema } from "effect";
import { FrontendError } from "./_lib/errors";
import { emptyForm, type Form, type Model, projectView } from "./state";
const DesignJson = Schema.fromJsonString(Design, { space: 2 });
const words = (value: string): readonly string[] => value.split(",").map(v => v.trim()).filter(v => v.length > 0);
const policyInput = (form: Form) => ({
  ...defaultPolicy,
  maxTradeUsd: Number(form.maxTrade),
  maxPositionPercent: Number(form.maxPosition),
  dailyLossLimitUsd: Number(form.lossLimit),
  approvalThresholdUsd: Number(form.threshold),
  maxSlippageBps: Number(form.slippage),
  launchAllowed: form.launchAllowed === "true",
  launchBudgetUsd: Number(form.launchBudget),
  allowedProtocols: words(form.protocols),
  allowedContracts: words(form.contracts),
  allowedMethods: words(form.methods),
});
const formError = () =>
  new FrontendError({ message: "Check the form values. Use valid non-negative limits and a complete design schema." });
export const formAction = (model: Model): Result.Result<Action, FrontendError> => {
  const f = model.form;
  if (model.modal === "agent") {
    return Schema.decodeUnknownResult(Action)({
      tag: "create-agent",
      name: f.name,
      mandate: f.mandate,
      policy: policyInput(f),
      visibility: f.visibility,
      // oxlint-disable-next-line effect/noNullish -- The Emblem transport schema explicitly represents no modifier with null.
      emblem: { shape: f.emblem, modifier: null },
      dailyBudget: Number(f.budget),
    }).pipe(Result.mapError(formError));
  }
  if (model.modal === "policy") {
    return Schema.decodeUnknownResult(Action)({
      tag: "update-agent",
      id: model.selectedAgent,
      name: f.name,
      mandate: f.mandate,
      policy: policyInput(f),
      visibility: f.visibility,
      publishMandate: f.publishMandate === "true",
      dailyBudget: Number(f.budget),
    }).pipe(Result.mapError(formError));
  }
  if (model.modal === "alert") {
    return Schema.decodeUnknownResult(Action)({
      tag: "alert",
      marketId: model.selectedMarket,
      price: Number(f.price),
      direction: f.direction,
    }).pipe(Result.mapError(formError));
  }
  if (model.modal === "design") {
    return Schema.decodeResult(DesignJson)(f.design).pipe(
      Result.map(design => ({ tag: "submit-design", design } satisfies Action)),
      Result.mapError(formError),
    );
  }
  if (model.modal === "launch") {
    return Schema.decodeResult(Action)({
      tag: "launch-draft",
      agentId: f.agentId,
      name: f.name,
      symbol: f.symbol,
      thesis: f.thesis,
      allocationPercent: Number(f.allocation),
    }).pipe(Result.mapError(formError));
  }
  if (model.modal === "withdraw") {
    return Schema.decodeResult(Action)({
      tag: "withdraw",
      agentId: model.selectedAgent,
      amount: f.amount.trim(),
    }).pipe(
      Result.mapError(() =>
        new FrontendError({ message: "Enter a positive ETH amount with at most 18 decimal places." })
      ),
    );
  }
  return Result.fail(new FrontendError({ message: "Open a form before submitting it." }));
};
const policyFields = (policy: Policy) => ({
  maxTrade: String(policy.maxTradeUsd),
  maxPosition: String(policy.maxPositionPercent),
  lossLimit: String(policy.dailyLossLimitUsd),
  threshold: String(policy.approvalThresholdUsd),
  slippage: String(policy.maxSlippageBps),
  launchAllowed: String(policy.launchAllowed),
  launchBudget: String(policy.launchBudgetUsd),
  protocols: policy.allowedProtocols.join(", "),
  contracts: policy.allowedContracts.join(", "),
  methods: policy.allowedMethods.join(", "),
});
export const openForm = (model: Model, modal: Model["modal"]): Result.Result<Form, FrontendError> => {
  const view = projectView(model);
  const agent = view.workspace?.agents.find(a => a.id === model.selectedAgent);
  if (modal === "policy" && agent) {
    return Result.succeed({
      ...emptyForm,
      ...policyFields(agent.policy),
      name: agent.name,
      mandate: agent.mandate,
      visibility: agent.visibility,
      publishMandate: String(agent.publishMandate),
      budget: String(agent.budget.dailyUsd),
    });
  }
  if (modal === "design") {
    const target = view.atlas?.market.markets.find(market => market.kind === lilyPondDesign.kind);
    return Schema.encodeResult(DesignJson)({ ...lilyPondDesign, tokenId: target?.id ?? lilyPondDesign.tokenId }).pipe(
      Result.map(design => ({ ...emptyForm, design })),
      Result.mapError(formError),
    );
  }
  return Result.succeed({
    ...emptyForm,
    price: String((view.atlas?.market.markets.find(m => m.id === model.selectedMarket)?.priceUsd ?? 0) * 1.1),
    agentId: agent?.id ?? view.workspace?.agents.find(a => a.owner === view.workspace?.owner.id)?.id ?? "",
  });
};
