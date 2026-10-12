import { BunServices } from "@effect/platform-bun";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { expect, it } from "@effect/vitest";
import { Agent, defaultPolicy, Proposal, publicReceipt, withoutTransaction } from "@floor/contract";
import { receiptVisibleAt } from "@floor/renderer/evidence";
import { Context, DateTime, Effect, FileSystem, Layer, Path, Record } from "effect";
import { TestClock } from "effect/testing";
import { databaseLayer, floorMigrations } from "../src/sqlite-store";
import { FloorDatabase } from "../src/store";

const beforeMigration = "2025-01-01T00:00:00.000Z";
// oxlint-disable-next-line effect/noNullish -- These are nullable fields of persisted JSON contracts.
const absent = null;
const proposal = (id: string, chainId: number) =>
  Proposal.make({
    id,
    agentId: "migration-agent",
    owner: "migration-owner",
    action: "trade",
    chainId,
    protocol: "migration-test",
    contract: "0x0000000000000000000000000000000000000001",
    method: "trade",
    recipient: "0x0000000000000000000000000000000000000002",
    marketId: "migration-market",
    amount: "1",
    symbol: "TEST",
    valueUsd: 1,
    slippageBps: 1,
    thesisId: "migration-thesis",
    sourceIds: [],
    createdAt: beforeMigration,
  });

it.layer(BunServices.layer)("receipt provenance migration", test => {
  test.effect("recovers chain ownership and conservatively dates legacy outcomes across a SQLite restart", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "floor-receipt-migration-" });
      const filename = path.join(directory, "receipts.sqlite");
      yield* TestClock.setTime(DateTime.toEpochMillis(
        yield* Effect.fromOption(DateTime.make("2026-01-01T00:00:00.000Z")),
      ));
      const canonical = proposal("canonical-proposal", 137);
      const legacy = proposal("legacy-proposal", 10);
      const orphan = proposal("orphan-proposal", 84532);
      const preserved = proposal("preserved-proposal", 1);
      yield* Effect.gen(function*() {
        const legacyDatabase = FloorDatabase.layer.pipe(
          Layer.provide(
            SqliteMigrator.layer({
              loader: SqliteMigrator.fromRecord(Record.filter(floorMigrations, (_, name) => name < "0006")),
            }),
          ),
          Layer.provide(SqliteClient.layer({ filename })),
        );
        const services = yield* Layer.build(legacyDatabase);
        const db = Context.get(services, FloorDatabase);
        yield* db.owners.insert({ id: canonical.owner, walletAddress: absent, mode: "local" });
        yield* db.agents.insert(Agent.make({
          id: canonical.agentId,
          owner: canonical.owner,
          name: "Migration agent",
          emblem: { shape: "circle", modifier: absent },
          walletAddress: absent,
          mandate: "Test an existing database",
          policy: defaultPolicy,
          visibility: "public",
          publishMandate: false,
          paused: false,
          state: "asleep",
          budget: { dailyUsd: 100, spentUsd: 0, day: "2025-01-01" },
          districtId: "base",
          createdAt: beforeMigration,
        }));
        yield* db.proposals.insert(canonical);
        yield* db.sql`INSERT INTO proposals_legacy ${db.sql.insert({ ...legacy, sourceIds: "[]" })}`;
        for (const declaration of [canonical, legacy, orphan, preserved]) {
          yield* db.receipts.insert({
            data: withoutTransaction({
              id: `receipt:${declaration.id}`,
              proposalId: declaration.id,
              proposalFingerprint: "preserved-fingerprint",
              agentId: declaration.agentId,
              owner: declaration.owner,
              marketId: declaration.marketId,
              chainId: declaration.chainId,
              action: "refusal",
              amount: declaration.amount,
              symbol: declaration.symbol,
              valueUsd: declaration.valueUsd,
              thesisId: declaration.thesisId,
              sourceIds: declaration.sourceIds,
              policyVersion: 1,
              checks: [],
              reason: "Historical refusal",
              createdAt: beforeMigration,
              updatedAt: beforeMigration,
              expiresAt: absent,
              status: "refused",
            }),
          });
        }
        // Reproduce the previous on-disk payload shape, then let the real migrator reacquire the closed database.
        yield* db.sql`UPDATE receipts SET data = json_remove(data, '$.chainId', '$.updatedAt')
          WHERE id != ${`receipt:${preserved.id}`}`;
        yield* db.sql`INSERT INTO notes (id,agentId,marketId,claim,sources,position,status,visibility,createdAt)
          VALUES ('legacy-note',${canonical.agentId},'migration-market','Legacy public claim','[]','{"disclosure":"undisclosed"}','sourced','public',${beforeMigration})`;
      }).pipe(Effect.scoped);
      yield* TestClock.adjust("1 day");
      const migrationAt = DateTime.formatIso(yield* DateTime.now);
      yield* Effect.gen(function*() {
        const services = yield* Layer.build(databaseLayer(filename));
        const db = Context.get(services, FloorDatabase);
        for (const declaration of [canonical, legacy, orphan]) {
          const receipt = (yield* db.receipts.findById(`receipt:${declaration.id}`)).data;
          expect(receipt.chainId).toBe(declaration.chainId);
          expect(receipt.updatedAt).toBe(migrationAt);
          expect(receipt.createdAt).toBe(beforeMigration);
          expect(receipt.proposalFingerprint).toBe("preserved-fingerprint");
          expect(receiptVisibleAt(publicReceipt(receipt), {
            observedAt: beforeMigration,
            chainId: 8453,
            blockNumber: 1,
          })).toBe(false);
        }
        const retained = (yield* db.receipts.findById(`receipt:${preserved.id}`)).data;
        expect(retained.chainId).toBe(1);
        expect(retained.updatedAt).toBe(beforeMigration);
        const migratedNote = yield* db.notes.findById("legacy-note");
        expect(migratedNote.visibility).toBe("private");
        expect(migratedNote.publicationReason).toContain("holdings at writing time have not been verified");
        expect(migratedNote.createdAt).toBe(beforeMigration);
        expect(yield* db.notes.listPublic()).toHaveLength(0);
      }).pipe(Effect.scoped);
    }));
});
