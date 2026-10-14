import { expect, test } from "bun:test";
import { Array, BigDecimal, DateTime, Effect, Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {
  Agent,
  Budget,
  ConfirmedPolicy,
  Owner,
  PositiveUsd,
  ProviderBalance,
  Usd,
  VerifiedWithdrawalDestination,
} from "../src/agents.ts";
import {
  ActionIntent,
  LaunchIntent,
  PolicyDecision,
  Receipt,
  ReceiptCause,
  ResolvedWithdrawal,
  SwapIntent,
  WithdrawalIntent,
} from "../src/economics.ts";
import {
  AccountRef,
  AssetRef,
  ChainRef,
  Checkpoint,
  DestinationId,
  Digest,
  OwnerId,
  ReceiptId,
  Timestamp,
  TransactionRef,
  WalletId,
} from "../src/identifiers.ts";
import { expectPassed, roundTrip, runTest } from "./_runtime.ts";

const propertyOptions = { seed: "economic-contracts", runs: 128, size: 6 };
const agentArbitrary = Arbitrary.schema(Schema.Struct(Agent.fields)).pipe(Arbitrary.map((agent) =>
  Agent.make({
    ...agent,
    policy: { ...agent.policy, owner: agent.owner },
    // Keep one wallet from a Schema-derived nonempty array, so every generated
    // agent satisfies the per-chain uniqueness rule before mutating it below.
    wallets: [agent.wallets[0]],
  })
));
const ownerArbitrary = Arbitrary.schema(Schema.Struct(Owner.fields)).pipe(Arbitrary.map((owner) => ({
  ...owner,
  withdrawalDestinations: Array.dedupeWith(owner.withdrawalDestinations, (a, b) => a.id === b.id).map((
    destination,
  ) => ({ ...destination, owner: owner.id })),
  wallets: Array.dedupeWith(owner.wallets, (a, b) => a.id === b.id || a.account === b.account),
})));
const scenarioArbitrary = Arbitrary.schema(Schema.Struct({
  action: LaunchIntent,
  policy: ConfirmedPolicy,
  id: ReceiptId,
  transaction: TransactionRef,
  checkpoint: Checkpoint,
  recordedAt: Timestamp,
  destinationId: DestinationId,
  verification: Digest,
  dollars: PositiveUsd,
})).pipe(Arbitrary.map((scenario) => ({
  ...scenario,
  policy: { ...scenario.policy, owner: scenario.action.owner },
  transaction: TransactionRef.make({ ...scenario.transaction, chain: scenario.action.chain }),
  checkpoint: Checkpoint.make({ ...scenario.checkpoint, chain: scenario.action.chain }),
})));
const settledArbitrary = scenarioArbitrary.pipe(
  Arbitrary.map((scenario) =>
    Receipt.cases.SettledReceipt.make({
      id: scenario.id,
      action: scenario.action,
      causes: [ReceiptCause.cases.OwnerRequest.make({ owner: scenario.action.owner, request: scenario.verification })],
      recordedAt: scenario.recordedAt,
      policy: scenario.policy,
      transaction: scenario.transaction,
      checkpoint: scenario.checkpoint,
      result: "succeeded",
    })
  ),
);
const withdrawalArbitrary = scenarioArbitrary.pipe(Arbitrary.map((scenario) =>
  WithdrawalIntent.make({
    id: scenario.action.id,
    agent: scenario.action.agent,
    owner: scenario.action.owner,
    chain: scenario.action.chain,
    requestedAt: scenario.action.requestedAt,
    asset: AssetRef.make(`${scenario.action.chain}/token:withdraw`),
    dollars: scenario.dollars,
    destination: scenario.destinationId,
  })
));
const resolvedWithdrawalArbitrary = scenarioArbitrary.pipe(Arbitrary.map((scenario) =>
  ResolvedWithdrawal.make({
    intent: WithdrawalIntent.make({
      id: scenario.action.id,
      agent: scenario.action.agent,
      owner: scenario.action.owner,
      chain: scenario.action.chain,
      requestedAt: scenario.action.requestedAt,
      asset: AssetRef.make(`${scenario.action.chain}/token:withdraw`),
      dollars: scenario.dollars,
      destination: scenario.destinationId,
    }),
    destination: VerifiedWithdrawalDestination.cases.OwnAccount.make({
      id: scenario.destinationId,
      owner: scenario.action.owner,
      account: AccountRef.make(`${scenario.action.chain}:owner`),
      verifiedAt: scenario.recordedAt,
      verification: scenario.verification,
    }),
  })
));
const swapArbitrary = scenarioArbitrary.pipe(Arbitrary.map((scenario) =>
  SwapIntent.make({
    id: scenario.action.id,
    agent: scenario.action.agent,
    owner: scenario.action.owner,
    chain: scenario.action.chain,
    requestedAt: scenario.action.requestedAt,
    sell: AssetRef.make(`${scenario.action.chain}/token:sell`),
    buy: AssetRef.make(`${scenario.action.chain}/token:buy`),
    dollars: scenario.dollars,
    slippageCap: 0.01,
  })
));

test("generated agents and owners preserve authority through JSON", () =>
  runTest(Effect.gen(function*() {
    yield* Arbitrary.checkEffect(agentArbitrary, (agent) => roundTrip(Agent, Agent.make(agent)), propertyOptions).pipe(
      Effect.tap(expectPassed),
    );
    yield* Arbitrary.checkEffect(ownerArbitrary, (owner) => roundTrip(Owner, owner), propertyOptions).pipe(
      Effect.tap(expectPassed),
    );
  })));

test("agents cannot use another owner's policy or duplicate a chain wallet", () =>
  runTest(
    Arbitrary.checkEffect(agentArbitrary, (agent) => {
      const differentOwner = OwnerId.make(agent.owner === "another-owner" ? "other-owner" : "another-owner");
      const first = agent.wallets[0];
      const otherChain = first.account.startsWith("other:chain:") ? "third:chain:wallet" : "other:chain:wallet";
      const sameChain = first.account.slice(0, first.account.lastIndexOf(":"));
      const differentId = WalletId.make(first.id === "second-wallet" ? "third-wallet" : "second-wallet");
      const differentAddress = first.account.endsWith(":second") ? "third" : "second";
      return !Schema.is(Agent)({ ...agent, policy: { ...agent.policy, owner: differentOwner } })
        && !Schema.is(Agent)({ ...agent, wallets: [first, first] })
        && !Schema.is(Agent)({ ...agent, wallets: [first, { ...first, account: AccountRef.make(otherChain) }] })
        && !Schema.is(Agent)({
          ...agent,
          wallets: [first, { id: differentId, account: AccountRef.make(`${sameChain}:${differentAddress}`) }],
        });
    }, propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("swaps round trip in the action union and reject same-asset or cross-chain swaps", () =>
  runTest(
    Arbitrary.checkEffect(swapArbitrary, (intent) =>
      Effect.gen(function*() {
        const otherChain = intent.chain === "eip155:1" ? "eip155:2" : "eip155:1";
        const valid = yield* roundTrip(ActionIntent, intent);
        return valid && !Schema.is(SwapIntent)({ ...intent, buy: intent.sell })
          && !Schema.is(SwapIntent)({ ...intent, buy: AssetRef.make(`${otherChain}/token:buy`) });
      }), propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("swaps reject a foreign-chain sell while the buy remains on the declared chain", () =>
  runTest(
    Arbitrary.checkEffect(swapArbitrary, (intent) => {
      const otherChain = intent.chain === "eip155:1" ? "eip155:2" : "eip155:1";
      return Schema.is(SwapIntent)(intent)
        && !Schema.is(SwapIntent)({ ...intent, sell: AssetRef.make(`${otherChain}/token:sell`) });
    }, propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("withdrawals carry only a destination reference and reject a cross-chain asset", () =>
  runTest(
    Arbitrary.checkEffect(withdrawalArbitrary, (intent) =>
      Effect.gen(function*() {
        const otherChain = intent.chain === "eip155:1" ? "eip155:2" : "eip155:1";
        const valid = yield* roundTrip(ActionIntent, intent);
        return valid
          && !Schema.is(WithdrawalIntent)({
            ...intent,
            destination: { id: intent.destination, verification: "self-asserted" },
          })
          && !Schema.is(WithdrawalIntent)({ ...intent, asset: AssetRef.make(`${otherChain}/token:withdraw`) });
      }), propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("resolved withdrawals reject the wrong destination, owner or account chain independently", () =>
  runTest(
    Arbitrary.checkEffect(resolvedWithdrawalArbitrary, (resolved) =>
      Effect.gen(function*() {
        const { intent, destination } = resolved;
        const differentOwner = OwnerId.make(intent.owner === "another-owner" ? "other-owner" : "another-owner");
        const differentId = DestinationId.make(
          destination.id === "other-destination" ? "third-destination" : "other-destination",
        );
        const otherChain = intent.chain === "eip155:1" ? "eip155:2" : "eip155:1";
        return (yield* roundTrip(ResolvedWithdrawal, resolved))
          && !Schema.is(ResolvedWithdrawal)({ ...resolved, destination: { ...destination, id: differentId } })
          && !Schema.is(ResolvedWithdrawal)({ ...resolved, destination: { ...destination, owner: differentOwner } })
          && !Schema.is(ResolvedWithdrawal)({
            ...resolved,
            destination: { ...destination, account: AccountRef.make(`${otherChain}:owner`) },
          });
      }), propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("withdrawal owner checks apply to banks as well as chain accounts", () =>
  runTest(
    Arbitrary.checkEffect(resolvedWithdrawalArbitrary, ({ intent, destination }) => {
      const bank = VerifiedWithdrawalDestination.cases.OwnBank.make({
        id: destination.id,
        owner: intent.owner,
        providerReference: "bank-owner",
        verifiedAt: destination.verifiedAt,
        verification: destination.verification,
      });
      const differentOwner = OwnerId.make(intent.owner === "another-owner" ? "other-owner" : "another-owner");
      return Schema.is(ResolvedWithdrawal)({ intent, destination: bank })
        && !Schema.is(ResolvedWithdrawal)({ intent, destination: { ...bank, owner: differentOwner } });
    }, propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("settled receipts preserve every cause, confirmed policy and chain checkpoint", () =>
  runTest(
    Arbitrary.checkEffect(settledArbitrary, (receipt) => roundTrip(Receipt, receipt), propertyOptions).pipe(
      Effect.tap(expectPassed),
    ),
  ));

test("a settled receipt cannot lose its cause, policy or checkpoint", () =>
  runTest(
    Arbitrary.checkEffect(settledArbitrary, (receipt) => {
      if (receipt._tag !== "SettledReceipt") return false;
      const { checkpoint: _checkpoint, ...withoutCheckpoint } = receipt;
      return !Schema.is(Receipt)(withoutCheckpoint)
        && !Schema.is(Receipt)({ ...receipt, causes: [] })
        && !Schema.is(Receipt)({
          ...receipt,
          // oxlint-disable-next-line effect/preferTaggedConstructors -- A malformed draft-policy substitution must reach the receipt validator rather than a constructor.
          policy: { ...receipt.policy, _tag: "DraftPolicy", requestedAt: receipt.recordedAt },
        });
    }, propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("receipts reject a foreign owner or a transaction/checkpoint from another chain", () =>
  runTest(
    Arbitrary.checkEffect(settledArbitrary, (receipt) => {
      if (receipt._tag !== "SettledReceipt") return false;
      const otherChain = ChainRef.make(receipt.action.chain === "eip155:1" ? "eip155:2" : "eip155:1");
      const differentOwner = OwnerId.make(receipt.action.owner === "another-owner" ? "other-owner" : "another-owner");
      return !Schema.is(Receipt)({ ...receipt, checkpoint: { ...receipt.checkpoint, chain: otherChain } })
        && !Schema.is(Receipt)({ ...receipt, transaction: { ...receipt.transaction, chain: otherChain } })
        && !Schema.is(Receipt)({ ...receipt, policy: { ...receipt.policy, owner: differentOwner } })
        && !Schema.is(Receipt)({
          ...receipt,
          causes: [ReceiptCause.cases.OwnerRequest.make({ owner: differentOwner, request: receipt.transaction.hash })],
        });
    }, propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("unknown outcomes round trip without invented transaction or checkpoint evidence", () =>
  runTest(
    Arbitrary.checkEffect(scenarioArbitrary, (scenario) =>
      Effect.gen(function*() {
        const receipt = Receipt.cases.UnknownReceipt.make({
          id: scenario.id,
          action: scenario.action,
          causes: [
            ReceiptCause.cases.OwnerRequest.make({ owner: scenario.action.owner, request: scenario.verification }),
          ],
          recordedAt: scenario.recordedAt,
          policy: scenario.policy,
          submission: scenario.verification,
          transaction: Option.none(),
          lastCheckedAt: Option.none(),
          reason: "Submission outcome is not yet known",
        });
        const roundTripped = yield* roundTrip(Receipt, receipt);
        const otherChain = ChainRef.make(receipt.action.chain === "eip155:1" ? "eip155:2" : "eip155:1");
        const withTransaction = { ...receipt, transaction: Option.some(scenario.transaction) };
        // oxlint-disable-next-line effect/preferTaggedConstructors -- Changing only the tag reproduces an unknown outcome falsely advertised as settled.
        const falseSettlement = { ...receipt, _tag: "SettledReceipt" };
        return roundTripped && !Schema.is(Receipt)(falseSettlement)
          && Schema.is(Receipt)(withTransaction)
          && !Schema.is(Receipt)({
            ...withTransaction,
            transaction: Option.some({ ...scenario.transaction, chain: otherChain }),
          });
      }), propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("unconfirmed and denied policies can produce only matching refusal receipts", () =>
  runTest(
    Arbitrary.checkEffect(scenarioArbitrary, (scenario) =>
      Effect.gen(function*() {
        const unconfirmed = Receipt.cases.RefusedReceipt.make({
          id: scenario.id,
          action: scenario.action,
          causes: [
            ReceiptCause.cases.OwnerRequest.make({ owner: scenario.action.owner, request: scenario.verification }),
          ],
          recordedAt: scenario.recordedAt,
          policy: PolicyDecision.cases.Unconfirmed.make({ policy: scenario.policy.id }),
          refusal: { code: "policyUnconfirmed", detail: "Awaiting owner confirmation" },
        });
        const denied = Receipt.cases.RefusedReceipt.make({
          ...unconfirmed,
          policy: PolicyDecision.cases.Denied.make({ policy: scenario.policy, reasons: ["Trade exceeds the cap"] }),
          refusal: { code: "policyDenied", detail: "Trade exceeds the cap" },
        });
        const allowed = Receipt.cases.RefusedReceipt.make({
          ...unconfirmed,
          policy: PolicyDecision.cases.Allowed.make({ policy: scenario.policy }),
          refusal: { code: "simulationFailed", detail: "Simulation failed" },
        });
        const differentOwner = OwnerId.make(
          scenario.action.owner === "another-owner" ? "other-owner" : "another-owner",
        );
        return (yield* roundTrip(Receipt, unconfirmed)) && (yield* roundTrip(Receipt, denied))
          && (yield* roundTrip(Receipt, allowed))
          && !Schema.is(Receipt)({ ...unconfirmed, refusal: { code: "simulationFailed", detail: "unrelated" } })
          && !Schema.is(Receipt)({ ...denied, refusal: { code: "policyUnconfirmed", detail: "unrelated" } })
          && !Schema.is(Receipt)({ ...allowed, refusal: { code: "policyDenied", detail: "unrelated" } })
          && !Schema.is(Receipt)({ ...allowed, refusal: { code: "policyUnconfirmed", detail: "unrelated" } })
          && !Schema.is(Receipt)({
            ...denied,
            policy: PolicyDecision.cases.Denied.make({
              policy: { ...scenario.policy, owner: differentOwner },
              reasons: ["Trade exceeds the cap"],
            }),
          });
      }), propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("money has no missing-as-zero path and keeps decimal precision across JSON", () =>
  runTest(Effect.gen(function*() {
    for (const absent of ["", " ", "NaN", "Infinity", "-1", "1\n", "1\r\n"]) {
      const result = yield* Schema.decodeEffect(Usd)(absent).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }
    const amount = yield* Schema.decodeEffect(Usd)("12345678901234567890.123456789");
    expect(BigDecimal.format(amount)).toBe("12345678901234567890.123456789");
    expect(yield* roundTrip(Usd, amount)).toBe(true);
    const zero = yield* Schema.decodeEffect(PositiveUsd)("0").pipe(Effect.result);
    expect(zero._tag).toBe("Failure");
    const instant = yield* Schema.decodeEffect(Timestamp)("2026-10-12T15:00:00.000Z");
    expect(DateTime.formatIso(instant)).toBe("2026-10-12T15:00:00.000Z");
    const budget = yield* Schema.decodeEffect(Budget)({
      limitDollars: "1",
      spentDollars: "2",
      periodStartedAt: "2026-10-12T15:00:00.000Z",
    }).pipe(Effect.result);
    expect(budget._tag).toBe("Failure");
  })));

test("every confirmed policy limit names the Privy policy that enforces it", () =>
  runTest(
    Arbitrary.checkEffect(scenarioArbitrary, ({ policy }) => {
      const limits = {
        ...policy.limits,
        dailyLossDollars: Option.some(policy.limits.tradeCapDollars),
        positionFraction: Option.some({ value: 0.5, providerPolicyId: policy.limits.tradeCapDollars.providerPolicyId }),
        approvalAboveDollars: Option.some(policy.limits.tradeCapDollars),
      };
      const confirmed = ConfirmedPolicy.make({ ...policy, limits });
      return [
        { ...limits, allowedPrograms: { value: limits.allowedPrograms.value } },
        { ...limits, allowedDestinations: { value: limits.allowedDestinations.value } },
        { ...limits, tradeCapDollars: { value: limits.tradeCapDollars.value } },
        { ...limits, launchAllowed: { value: limits.launchAllowed.value } },
        { ...limits, dailyLossDollars: Option.some({ value: limits.tradeCapDollars.value }) },
        { ...limits, positionFraction: Option.some({ value: 0.5 }) },
        { ...limits, approvalAboveDollars: Option.some({ value: limits.tradeCapDollars.value }) },
      ].every((incomplete) => !Schema.is(ConfirmedPolicy)({ ...confirmed, limits: incomplete }));
    }, propertyOptions).pipe(Effect.tap(expectPassed)),
  ));

test("money accepts one bounded decimal spelling and rejects hostile scales before arithmetic", () =>
  runTest(Effect.gen(function*() {
    for (
      const wire of [
        "1e1000000",
        "1e-1000000",
        "1e9007199254740992",
        "1e-9007199254740992",
        "1e999999999999999999999",
        "+1",
        "01",
        "1.0",
        "0.00",
        ".1",
        "1.",
        "1E2",
        "-0",
        "1000000000000000000000000000000",
        "0.0000000000000000001",
      ]
    ) {
      expect((yield* Schema.decodeEffect(Usd)(wire).pipe(Effect.result))._tag).toBe("Failure");
    }
    for (const wire of ["0", "0.000000000000000001", "999999999999999999999999999999.999999999999999999"]) {
      const amount = yield* Schema.decodeEffect(Usd)(wire);
      expect(yield* Schema.encodeEffect(Usd)(amount)).toBe(wire);
    }
    for (
      const amount of [
        BigDecimal.make(1n, Number.MAX_SAFE_INTEGER),
        BigDecimal.make(1n, -Number.MAX_SAFE_INTEGER),
        BigDecimal.make(1n, 19),
        BigDecimal.make(1n, -30),
        BigDecimal.make(10n ** 48n, 18),
      ]
    ) {
      expect((yield* Schema.encodeUnknownEffect(Usd)(amount).pipe(Effect.result))._tag).toBe("Failure");
      expect((yield* Schema.encodeUnknownEffect(PositiveUsd)(amount).pipe(Effect.result))._tag).toBe("Failure");
    }
  })));

test("timestamps require real canonical ISO instants and digests accept padded base64", () =>
  runTest(Effect.gen(function*() {
    for (
      const text of [
        "0",
        "October 12, 2026",
        "10/12/2026",
        "2026-10-12",
        "2026-10-12T15:00:00",
        "2026-02-30T00:00:00.000Z",
        "2026-10-12T15:00:00.000+00:00",
      ]
    ) {
      expect((yield* Schema.decodeEffect(Timestamp)(text).pipe(Effect.result))._tag).toBe("Failure");
    }
    for (const text of ["0000-01-01T00:00:00.000Z", "2024-02-29T00:00:00.000Z", "9999-12-31T23:59:59.999Z"]) {
      const time = yield* Schema.decodeEffect(Timestamp)(text);
      expect(yield* Schema.encodeEffect(Timestamp)(time)).toBe(text);
    }
    for (const digest of ["dGVzdA==", "YWJjZGU=", "sha256:abc/def+123=", "abcdef0123456789"]) {
      const decoded = yield* Schema.decodeEffect(Digest)(digest);
      expect(yield* roundTrip(Digest, decoded)).toBe(true);
    }
    for (const digest of ["", "=abc", "a=b", "abc===", "a".repeat(257)]) {
      expect((yield* Schema.decodeEffect(Digest)(digest).pipe(Effect.result))._tag).toBe("Failure");
    }
  })));

test("owners cannot repeat withdrawal destinations or wallet authority references", () =>
  runTest(
    Arbitrary.checkEffect(resolvedWithdrawalArbitrary, ({ intent, destination }) => {
      const owner = Owner.make({
        id: intent.owner,
        identity: { provider: "privy", subject: "owner-account" },
        wallets: [],
        withdrawalDestinations: [destination],
        balance: ProviderBalance.cases.Unavailable.make({
          reason: "No balance queried",
          checkedAt: intent.requestedAt,
        }),
      });
      const wallet = { id: WalletId.make("owner-wallet"), account: AccountRef.make("eip155:1:owner") };
      const differentOwner = OwnerId.make(intent.owner === "another-owner" ? "other-owner" : "another-owner");
      return !Schema.is(Owner)({ ...owner, withdrawalDestinations: [{ ...destination, owner: differentOwner }] })
        && !Schema.is(Owner)({ ...owner, withdrawalDestinations: [destination, destination] })
        && !Schema.is(Owner)({ ...owner, wallets: [wallet, wallet] })
        && !Schema.is(Owner)({ ...owner, wallets: [wallet, { ...wallet, id: WalletId.make("other-owner-wallet") }] })
        && !Schema.is(Owner)({
          ...owner,
          wallets: [wallet, { ...wallet, account: AccountRef.make("other:chain:owner") }],
        });
    }, propertyOptions).pipe(Effect.tap(expectPassed)),
  ));
