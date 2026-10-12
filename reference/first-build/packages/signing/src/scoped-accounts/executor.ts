import { Address, type Proposal } from "@floor/contract";
import { encodeFoundryLaunch } from "@floor/foundry";
import { DateTime, Effect, Layer, Option, Schema } from "effect";
import { type SigningRecord, TransactionExecutor, TransactionOutcomeUnknown, TransactionRejected } from "../execution";
import { evaluatePolicy, fingerprintProposal } from "../policy";
import { accountIsCurrent, sameAccountBinding, ScopedAccounts } from "./accounts";
import { type AccountBinding, type PreparedExecution, type ScopedAccount } from "./protocol";

const sameAddress = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
const permittedCall = (account: ScopedAccount, plan: PreparedExecution): boolean =>
  account.permissions.some((permission) =>
    sameAddress(permission.contract, plan.target) && permission.method === plan.method
    && permission.selector === plan.selector
    && sameAddress(permission.asset, plan.asset) && sameAddress(permission.recipient, plan.recipient)
    && BigInt(plan.assetAmount) <= BigInt(permission.maximumAmount)
    && BigInt(plan.nativeValue) <= BigInt(permission.maximumNativeValue)
  );

const matchesApprovedPlan = (
  plan: PreparedExecution,
  request: Proposal,
  authority: SigningRecord,
  account: ScopedAccount,
  binding: AccountBinding,
  now: DateTime.Utc,
): boolean => {
  const approvalExpiry = Option.flatMap(Option.fromNullishOr(authority.receipt.expiresAt), DateTime.make);
  const quoteExpiry = Option.flatMap(authority.context.quoteExpiresAt, DateTime.make);
  return sameAccountBinding(binding, plan.binding) && sameAddress(plan.account, account.account)
    && plan.receiptId === authority.receipt.id && plan.proposalFingerprint === authority.receipt.proposalFingerprint
    && plan.permissionId === account.permissionId && sameAddress(plan.target, request.contract)
    && plan.method === request.method && sameAddress(plan.recipient, request.recipient)
    && plan.amount === request.amount && plan.symbol === request.symbol && plan.valueUsd === request.valueUsd
    && plan.slippageBps === request.slippageBps && plan.calldata.toLowerCase().startsWith(plan.selector.toLowerCase())
    && DateTime.isLessThan(now, plan.expiresAt) && DateTime.isLessThanOrEqualTo(plan.expiresAt, account.expiresAt)
    && Option.exists(approvalExpiry, (expires) => DateTime.isLessThanOrEqualTo(plan.expiresAt, expires))
    && (request.action === "withdraw"
      || Option.exists(quoteExpiry, (expires) => DateTime.isLessThanOrEqualTo(plan.expiresAt, expires)))
    && permittedCall(account, plan);
};

const reservedAuthority = (proposal: Proposal, id: string, authority: SigningRecord, now: DateTime.Utc): boolean =>
  proposal.chainId === 84532 && authority.receipt.status === "executing" && authority.receipt.id === id
  && authority.receipt.proposalId === proposal.id && authority.receipt.owner === proposal.owner
  && authority.receipt.agentId === proposal.agentId && authority.receipt.policyVersion === authority.policy.version
  && authority.receipt.proposalFingerprint === fingerprintProposal(proposal)
  && authority.receipt.proposalFingerprint === fingerprintProposal(authority.proposal)
  && evaluatePolicy(proposal, authority.policy, { ...authority.context, now: DateTime.formatIso(now) }).decision
    !== "refuse";

export const scopedTransactionExecutorLayer = Layer.effect(
  TransactionExecutor,
  Effect.gen(function*() {
    const accounts = yield* ScopedAccounts;
    return TransactionExecutor.of({
      execute: Effect.fn("ScopedTransactionExecutor.execute")(
        function*(proposal: Proposal, id: string, authority: SigningRecord) {
          const now = yield* DateTime.now;
          if (
            !reservedAuthority(proposal, id, authority, now) || Option.isNone(authority.context.ownerAddress)
            || Option.isNone(authority.context.walletAddress)
          ) {
            return yield* new TransactionRejected({
              message: "A current owner-bound Base Sepolia execution reservation is required.",
            });
          }
          const ownerAddress = yield* Schema.decodeUnknownEffect(Address)(authority.context.ownerAddress.value).pipe(
            Effect.mapError(() => new TransactionRejected({ message: "The bound owner's wallet address is invalid." })),
          );
          const binding = yield* accounts.binding(proposal.owner, ownerAddress, proposal.agentId, authority.policy);
          const linked = yield* accounts.read(binding);
          if (
            Option.isNone(linked) || !accountIsCurrent(binding, linked.value, now)
            || !sameAddress(linked.value.account, authority.context.walletAddress.value)
          ) {
            return yield* new TransactionRejected({
              message: "The verified scoped account no longer matches this execution reservation.",
            });
          }
          const account = linked.value;
          const approvalExpiresAt = Option.flatMap(Option.fromNullishOr(authority.receipt.expiresAt), DateTime.make);
          if (Option.isNone(approvalExpiresAt) || !DateTime.isLessThan(now, approvalExpiresAt.value)) {
            return yield* new TransactionRejected({ message: "The owner approval has expired." });
          }
          const plan = yield* accounts.prepare({
            binding,
            account: account.account,
            permissionId: account.permissionId,
            receiptId: id,
            proposal,
            proposalFingerprint: authority.receipt.proposalFingerprint,
            approvalExpiresAt: approvalExpiresAt.value,
          });
          if (!matchesApprovedPlan(plan, proposal, authority, account, binding, yield* DateTime.now)) {
            return yield* new TransactionRejected({
              message: "The simulated call differs from the approved proposal or exceeds its on-chain session limits.",
            });
          }
          if (proposal.action === "launch") {
            const expected = yield* encodeFoundryLaunch(proposal.launch).pipe(
              Effect.mapError((error) => new TransactionRejected({ message: error.message })),
            );
            if (
              plan.calldata.toLowerCase() !== expected.calldata.toLowerCase()
              || BigInt(plan.nativeValue) !== expected.value
            ) {
              return yield* new TransactionRejected({
                message: "The simulated foundry call does not exactly encode the approved launch parameters.",
              });
            }
          }
          const response = yield* accounts.dispatch({
            planId: plan.planId,
            receiptId: id,
            proposalFingerprint: plan.proposalFingerprint,
            permissionId: plan.permissionId,
          });
          if (
            response.receiptId !== id || response.proposalFingerprint !== plan.proposalFingerprint
            || !sameAddress(response.account, account.account)
          ) {
            return yield* new TransactionOutcomeUnknown({
              message:
                "The signer returned evidence for a different dispatch. Reconcile this receipt before any further action.",
            });
          }
          if (response.status === "rejected") return yield* new TransactionRejected({ message: response.reason });
          return {
            transactionHash: response.transactionHash,
            blockNumber: response.status === "confirmed" ? Option.some(response.blockNumber) : Option.none(),
          };
        },
      ),
    });
  }),
);
