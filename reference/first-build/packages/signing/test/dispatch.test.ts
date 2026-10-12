import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { expect, layer } from "@effect/vitest";
import { defaultPolicy, type Policy, type Proposal, publicReceipt, Receipt } from "@floor/contract";
import { receiptVisibleAt } from "@floor/renderer/evidence";
import { DateTime, Deferred, Effect, Fiber, FileSystem, Option, Ref, Result, Schema, Semaphore } from "effect";
import { TestClock } from "effect/testing";
import {
  createReceipt,
  dispatchApproved,
  SigningJournal,
  SigningJournalError,
  TransactionExecutor,
  TransactionOutcomeUnknown,
  TransactionRejected,
  type TransactionResult,
} from "../src/index";
import type { PolicyContext } from "../src/policy";
const account = "0x1111111111111111111111111111111111111111";
const contract = "0x2222222222222222222222222222222222222222";
const now = "2026-10-11T12:00:00Z";
const policy: Policy = {
  ...defaultPolicy,
  allowedContracts: [contract],
  allowedProtocols: ["pool"],
  allowedMethods: ["swap"],
  confirmedAt: now,
};
const proposal: Proposal = {
  id: "p",
  agentId: "wren",
  owner: "owner",
  action: "trade",
  chainId: 84532,
  protocol: "pool",
  contract,
  method: "swap",
  recipient: account,
  marketId: "pool",
  amount: "1",
  symbol: "TOKEN",
  valueUsd: 1,
  slippageBps: 0,
  thesisId: "t",
  sourceIds: ["s"],
  createdAt: now,
};
const context: PolicyContext = {
  owner: "owner",
  ownerAddress: Option.some(account),
  walletAddress: Option.some(account),
  agentId: "wren",
  paused: false,
  now,
  walletUsd: 1000,
  resultingPositionUsd: 1,
  dailyLossUsd: 0,
  quotedValueUsd: Option.some(1),
  quoteExpiresAt: Option.some("2026-10-11T12:15:00Z"),
  agentLaunchesToday: 0,
  ownerLaunchesThisWeek: 0,
  allocationLockedUntil: Option.none(),
  sourceEvidenceVerified: true,
  launchGateApproved: true,
  isTestnet: true,
};
const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ReceiptJson = Schema.fromJsonString(Receipt);
const storedJournal = Effect.fn("Testing.storedJournal")(function*() {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "floor-signing-" });
  const file = `${directory}/receipt.json`;
  const initial = yield* Schema.encodeEffect(ReceiptJson)(createReceipt(proposal, policy, context));
  yield* fs.writeFileString(file, initial);
  const mutex = yield* Semaphore.make(1);
  const read = fs.readFileString(file).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ReceiptJson)),
    Effect.mapError((error) => new SigningJournalError({ message: error.message })),
  );
  const write = Effect.fn("Testing.writeReceipt")(function*(receipt: Receipt) {
    const json = yield* Schema.encodeEffect(ReceiptJson)(receipt);
    yield* fs.writeFileString(`${file}.next`, json);
    yield* fs.rename(`${file}.next`, file);
  }, Effect.mapError((error) => new SigningJournalError({ message: error.message })));
  const journal = SigningJournal.of({
    read: () => read.pipe(Effect.map((receipt) => Option.some({ receipt, policy, proposal, context }))),
    compareAndSet: (expected, next) =>
      Effect.gen(function*() {
        const before = yield* read;
        const actual = yield* Schema.encodeEffect(ReceiptJson)(before);
        const expectedJson = yield* Schema.encodeEffect(ReceiptJson)(expected.receipt);
        if (actual !== expectedJson) return false;
        yield* write(next);
        return true;
      }).pipe(
        Semaphore.withPermits(mutex, 1),
        Effect.mapError((error) => new SigningJournalError({ message: error.message })),
      ),
  });
  return { journal, read, write };
});
const runDispatch = (journal: SigningJournal["Service"], executor: TransactionExecutor["Service"]) => {
  return dispatchApproved("receipt:p").pipe(
    Effect.provideService(SigningJournal, journal),
    Effect.provideService(TransactionExecutor, executor),
  );
};

const delayedObservation = Effect.fn("Testing.delayedObservation")(function*(status: "confirmed" | "uncertain") {
  yield* TestClock.setTime(DateTime.toEpochMillis(yield* Effect.fromOption(DateTime.make(now))));
  const stored = yield* storedJournal();
  const started = yield* Deferred.make<boolean>();
  const outcome = yield* Deferred.make<TransactionResult, TransactionOutcomeUnknown>();
  const executor = TransactionExecutor.of({
    execute: () => Deferred.succeed(started, true).pipe(Effect.andThen(Deferred.await(outcome))),
  });
  const dispatched = yield* runDispatch(stored.journal, executor).pipe(Effect.forkScoped);
  yield* Deferred.await(started);
  yield* TestClock.adjust("45 seconds");
  const historicalObservation = {
    chainId: 8453,
    blockNumber: 9_000_000,
    observedAt: DateTime.formatIso(yield* DateTime.now),
  };
  expect((yield* stored.read).status).toBe("executing");
  yield* TestClock.adjust("45 seconds");
  const learnedAt = DateTime.formatIso(yield* DateTime.now);
  if (status === "confirmed") {
    yield* Deferred.succeed(
      outcome,
      { transactionHash: hash, blockNumber: Option.some(17) } satisfies TransactionResult,
    );
  } else {yield* Deferred.fail(
      outcome,
      new TransactionOutcomeUnknown({ message: "The remote response was lost after submission" }),
    );}
  const result = yield* Fiber.join(dispatched);
  expect(result.status).toBe(status);
  expect(result.updatedAt).toBe(learnedAt);
  expect(result.createdAt).toBe(context.now);
  expect(result.chainId).toBe(proposal.chainId);
  expect((yield* stored.read).updatedAt).toBe(learnedAt);
  // A tiny Sepolia transaction block must not make its later outcome appear in an earlier Base observation.
  expect(receiptVisibleAt(publicReceipt(result), historicalObservation)).toBe(false);
  expect(receiptVisibleAt(publicReceipt(result), { ...historicalObservation, observedAt: learnedAt })).toBe(true);
  const observedAgain = yield* runDispatch(stored.journal, executor);
  expect(observedAgain.updatedAt).toBe(learnedAt);
});

layer(BunFileSystem.layer)("Authoritative dispatch ownership", (it) => {
  it.effect("historical cutoffs cannot expose confirmation before the remote result arrives", () =>
    delayedObservation("confirmed"));
  it.effect("uncertainty is dated when the remote outcome is learned, without changing its chain or creation time", () =>
    delayedObservation("uncertain"));
  it.effect("a fresh atomic reservation grants one send across competing callers", () =>
    Effect.gen(function*() {
      const stored = yield* storedJournal();
      const sends = yield* Ref.make(0);
      const executor = TransactionExecutor.of({
        execute: () =>
          Ref.update(sends, (count) => count + 1).pipe(
            Effect.as({ transactionHash: hash, blockNumber: Option.some(17) }),
          ),
      });
      const results = yield* Effect.all(
        [runDispatch(stored.journal, executor), runDispatch(stored.journal, executor)],
        { concurrency: 2 },
      );
      expect(yield* Ref.get(sends)).toBe(1);
      expect((yield* stored.read).status).toBe("confirmed");
      expect(results.some((result) => result.status === "confirmed")).toBe(true);
    }));
  it.effect("unknown remote acceptance survives a new service instance and never resends", () =>
    Effect.gen(function*() {
      const stored = yield* storedJournal();
      const sends = yield* Ref.make(0);
      const executor = TransactionExecutor.of({
        execute: () =>
          Ref.update(sends, (count) => count + 1).pipe(
            Effect.andThen(Effect.fail(new TransactionOutcomeUnknown({ message: "Connection lost after send" }))),
          ),
      });
      expect((yield* runDispatch(stored.journal, executor)).status).toBe("uncertain");
      const reopened = SigningJournal.of({
        ...stored.journal,
        read: () => stored.read.pipe(Effect.map((receipt) => Option.some({ receipt, policy, proposal, context }))),
      });
      expect((yield* runDispatch(reopened, executor)).status).toBe("uncertain");
      expect(yield* Ref.get(sends)).toBe(1);
    }));
  it.effect("known-unsent failures stay distinct from uncertainty", () =>
    Effect.gen(function*() {
      const stored = yield* storedJournal();
      const rejected = TransactionExecutor.of({
        execute: () => Effect.fail(new TransactionRejected({ message: "Simulation reverted before signing" })),
      });
      const result = yield* runDispatch(stored.journal, rejected);
      expect(result.status).toBe("failed");
      expect(result.transactionHash).toBeNull();
    }));
  it.effect("a dispatched transaction with malformed evidence cannot become safe to resend", () =>
    Effect.gen(function*() {
      const stored = yield* storedJournal();
      const executor = TransactionExecutor.of({
        execute: () => Effect.succeed({ transactionHash: "0x123", blockNumber: Option.some(3) }),
      });
      expect((yield* runDispatch(stored.journal, executor)).status).toBe("uncertain");
    }));
  it.effect("reopening after remote send but before receipt commit preserves the dispatch guard", () =>
    Effect.gen(function*() {
      const stored = yield* storedJournal();
      const sends = yield* Ref.make(0);
      const faulting = SigningJournal.of({
        ...stored.journal,
        compareAndSet: (expected, next) =>
          next.status === "confirmed"
            ? Effect.fail(new SigningJournalError({ message: "Power lost during result commit" }))
            : stored.journal.compareAndSet(expected, next),
      });
      const executor = TransactionExecutor.of({
        execute: () =>
          Ref.update(sends, (count) => count + 1).pipe(
            Effect.as({ transactionHash: hash, blockNumber: Option.some(9) }),
          ),
      });
      const failure = yield* Effect.result(runDispatch(faulting, executor));
      expect(Result.isFailure(failure)).toBe(true);
      expect((yield* stored.read).status).toBe("executing");
      expect((yield* runDispatch(stored.journal, executor)).status).toBe("executing");
      expect(yield* Ref.get(sends)).toBe(1);
    }));
  it("schema cannot express confirmed or pending receipts with contradictory evidence", () => {
    const receipt = createReceipt(proposal, policy, context);
    expect(Result.isFailure(Schema.decodeUnknownResult(Receipt)({ ...receipt, status: "confirmed" }))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(Receipt)({ ...receipt, transactionHash: hash }))).toBe(true);
  });
});
