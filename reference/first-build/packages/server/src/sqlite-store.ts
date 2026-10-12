import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { MarketHistorySql } from "@floor/markets";
import { Config, DateTime, Effect, FileSystem, Layer, Path } from "effect";
import { SqlClient } from "effect/sql";
import { FloorDatabase } from "./store";

/** Canonical versioned schema, also used to open genuine older databases in migration proofs. @stability unstable */
export const floorMigrations = {
  "0001_floor": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE owners (id TEXT PRIMARY KEY, walletAddress TEXT, mode TEXT NOT NULL)`;
    yield* sql`CREATE UNIQUE INDEX owners_wallet ON owners(walletAddress) WHERE walletAddress IS NOT NULL`;
    yield* sql`CREATE TABLE agents (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id), name TEXT NOT NULL, emblem TEXT NOT NULL, walletAddress TEXT, mandate TEXT NOT NULL, policy TEXT NOT NULL, visibility TEXT NOT NULL, publishMandate INTEGER NOT NULL, state TEXT NOT NULL, budget TEXT NOT NULL, districtId TEXT NOT NULL, createdAt TEXT NOT NULL)`;
    yield* sql`CREATE UNIQUE INDEX agent_emblem ON agents(districtId, json_extract(emblem, '$.shape'), COALESCE(json_extract(emblem, '$.modifier'), ''))`;
    yield* sql`CREATE INDEX agents_owner ON agents(owner)`;
    yield* sql`CREATE TABLE notes (id TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), marketId TEXT NOT NULL, claim TEXT NOT NULL, sources TEXT NOT NULL, position TEXT NOT NULL, status TEXT NOT NULL, visibility TEXT NOT NULL, createdAt TEXT NOT NULL, blockNumber INTEGER, verification TEXT, launchAllocation TEXT)`;
    yield* sql`CREATE TABLE theses (id TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), marketId TEXT NOT NULL, belief TEXT NOT NULL, invalidation TEXT NOT NULL, noteIds TEXT NOT NULL, createdAt TEXT NOT NULL)`;
    yield* sql`CREATE TABLE threads (id TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), question TEXT NOT NULL, marketIds TEXT NOT NULL, finding TEXT, createdAt TEXT NOT NULL)`;
    yield* sql`CREATE TABLE briefs (id TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), date TEXT NOT NULL, text TEXT NOT NULL, receiptIds TEXT NOT NULL, noteIds TEXT NOT NULL, visibility TEXT NOT NULL)`;
    yield* sql`CREATE TABLE proposals (id TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), owner TEXT NOT NULL REFERENCES owners(id), action TEXT NOT NULL, chainId INTEGER NOT NULL, protocol TEXT NOT NULL, contract TEXT NOT NULL, method TEXT NOT NULL, recipient TEXT NOT NULL, marketId TEXT NOT NULL, amount TEXT NOT NULL, symbol TEXT NOT NULL, valueUsd REAL NOT NULL, slippageBps REAL NOT NULL, thesisId TEXT NOT NULL, sourceIds TEXT NOT NULL, createdAt TEXT NOT NULL)`;
    yield* sql`CREATE TABLE receipts (data TEXT NOT NULL CHECK(json_valid(data)), id TEXT GENERATED ALWAYS AS (json_extract(data, '$.id')) STORED UNIQUE NOT NULL)`;
    yield* sql`CREATE UNIQUE INDEX receipt_proposal ON receipts(json_extract(data, '$.proposalId'))`;
    yield* sql`CREATE TABLE alerts (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id), marketId TEXT NOT NULL, price REAL NOT NULL, crossed INTEGER NOT NULL, direction TEXT NOT NULL, createdAt TEXT NOT NULL)`;
    yield* sql`CREATE TABLE plates (number INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, createdAt TEXT NOT NULL, blockNumber INTEGER NOT NULL, marketId TEXT NOT NULL, receiptIds TEXT NOT NULL, view TEXT NOT NULL, image TEXT NOT NULL)`;
    yield* sql`CREATE TABLE designs (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id), design TEXT NOT NULL, status TEXT NOT NULL, checks TEXT NOT NULL, createdAt TEXT NOT NULL)`;
    yield* sql`CREATE TABLE launches (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id), agentId TEXT NOT NULL REFERENCES agents(id), name TEXT NOT NULL, symbol TEXT NOT NULL, thesis TEXT NOT NULL, allocationPercent REAL NOT NULL, createdAt TEXT NOT NULL, status TEXT NOT NULL, receiptId TEXT)`;
    yield* sql`CREATE TABLE activity (agentId TEXT PRIMARY KEY REFERENCES agents(id), state TEXT NOT NULL, message TEXT NOT NULL, browserUrl TEXT, liveViewUrl TEXT, untrusted INTEGER NOT NULL, updatedAt TEXT NOT NULL)`;
    yield* sql`CREATE TABLE events (id TEXT PRIMARY KEY, type TEXT NOT NULL, blockNumber INTEGER, createdAt TEXT NOT NULL, actor TEXT NOT NULL, entityId TEXT NOT NULL, payload TEXT NOT NULL)`;
    yield* sql`CREATE INDEX events_actor ON events(actor)`;
    yield* sql`CREATE INDEX events_entity ON events(entityId)`;
    yield* sql`CREATE TABLE challenges (id TEXT PRIMARY KEY, owner TEXT NOT NULL, message TEXT NOT NULL, expiresAt INTEGER NOT NULL)`;
    yield* sql`CREATE TABLE owner_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id), expiresAt INTEGER NOT NULL)`;
    yield* sql`CREATE TABLE moorings (owner TEXT NOT NULL REFERENCES owners(id), marketId TEXT NOT NULL, PRIMARY KEY(owner, marketId))`;
  }),
  "0002_market_history": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE market_snapshots (blockNumber INTEGER PRIMARY KEY, blockHash TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)))`;
    yield* sql`CREATE TABLE market_snapshot_pins (blockNumber INTEGER PRIMARY KEY REFERENCES market_snapshots(blockNumber))`;
  }),
  "0003_proposal_declarations": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    // Legacy launch rows did not bind exact factory arguments; retain them for audit without inventing executable details.
    yield* sql`ALTER TABLE proposals RENAME TO proposals_legacy`;
    yield* sql`CREATE TABLE proposals (data TEXT NOT NULL CHECK(json_valid(data)), id TEXT GENERATED ALWAYS AS (json_extract(data, '$.id')) STORED UNIQUE NOT NULL)`;
    yield* sql`INSERT INTO proposals(data) SELECT json_object('id',id,'agentId',agentId,'owner',owner,'action',action,'chainId',chainId,'protocol',protocol,'contract',contract,'method',method,'recipient',recipient,'marketId',marketId,'amount',amount,'symbol',symbol,'valueUsd',valueUsd,'slippageBps',slippageBps,'thesisId',thesisId,'sourceIds',json(sourceIds),'createdAt',createdAt) FROM proposals_legacy WHERE action IN ('trade','withdraw')`;
  }),
  "0004_market_slots": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE market_slots (marketId TEXT PRIMARY KEY, slot INTEGER NOT NULL UNIQUE CHECK(slot >= 0))`;
  }),
  "0005_owner_pause": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    // Older rows conflated sleep with revoked authority. Resume requires an explicit owner action after migration.
    yield* sql`ALTER TABLE agents ADD COLUMN paused INTEGER NOT NULL DEFAULT 1 CHECK(paused IN (0, 1))`;
  }),
  "0006_receipt_provenance": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    // Legacy final outcomes have no trustworthy observation time. Migration time prevents replay from presenting hindsight.
    // Every previously dispatchable receipt used Base Sepolia; saved proposals preserve refused requests to other chains.
    yield* sql`UPDATE receipts SET data = json_set(data,
        '$.chainId', COALESCE(json_extract(data, '$.chainId'),
          (SELECT json_extract(p.data, '$.chainId') FROM proposals p WHERE p.id = json_extract(receipts.data, '$.proposalId')),
          (SELECT p.chainId FROM proposals_legacy p WHERE p.id = json_extract(receipts.data, '$.proposalId')), 84532),
        '$.updatedAt', COALESCE(json_extract(data, '$.updatedAt'), ${observedAt}))
        WHERE json_type(data, '$.chainId') IS NULL OR json_type(data, '$.updatedAt') IS NULL`;
  }),
  "0007_launch_gate": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE launch_reviews (proposalId TEXT PRIMARY KEY REFERENCES proposals(id), data TEXT NOT NULL CHECK(json_valid(data)))`;
  }),
  "0008_holder_design_votes": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE design_elections (data TEXT NOT NULL CHECK(json_valid(data)), id TEXT GENERATED ALWAYS AS (json_extract(data, '$.id')) STORED UNIQUE NOT NULL)`;
    yield* sql`CREATE UNIQUE INDEX design_election_open_market ON design_elections(json_extract(data, '$.marketId')) WHERE json_extract(data, '$.status') = 'open'`;
    yield* sql`CREATE TABLE design_ballots (electionId TEXT NOT NULL REFERENCES design_elections(id), wallet TEXT NOT NULL, weight TEXT NOT NULL, support INTEGER NOT NULL CHECK(support IN (0,1)), PRIMARY KEY(electionId, wallet))`;
  }),
  "0009_research_evidence": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE notes ADD COLUMN positionEvidence TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(positionEvidence))`;
    yield* sql`ALTER TABLE notes ADD COLUMN publicationReason TEXT`;
    yield* sql`ALTER TABLE notes ADD COLUMN assertion TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(assertion))`;
    yield* sql`ALTER TABLE notes ADD COLUMN assertionEvidence TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(assertionEvidence))`;
    // A legacy disclosure has no chain identity or observation block; public history must not imply it was verified.
    yield* sql`UPDATE notes SET visibility = 'private', publicationReason = 'Publication pending: holdings at writing time have not been verified.' WHERE visibility = 'public'`;
    yield* sql`UPDATE briefs SET visibility = 'private' WHERE visibility = 'public'`;
  }),
  "0010_district_tiers": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE district_tiers (blockNumber INTEGER PRIMARY KEY REFERENCES market_snapshots(blockNumber) ON DELETE CASCADE, blockHash TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)))`;
    // Later assignments depend on earlier hysteresis; replacing a canonical source invalidates the whole dependent suffix.
    yield* sql`CREATE TRIGGER district_tiers_reorg AFTER UPDATE OF blockHash ON market_snapshots
        WHEN OLD.blockHash <> NEW.blockHash BEGIN DELETE FROM district_tiers WHERE blockNumber >= NEW.blockNumber; END`;
  }),
};
const schema = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(floorMigrations) });

// Driver acquisition owns connection lifetime and native transaction isolation; migrations precede every repository consumer.
/** @stability unstable */
export const databaseLayer = (filename: string) => {
  const sqlite = Layer.effectDiscard(Effect.flatMap(SqlClient.SqlClient, sql => sql`PRAGMA foreign_keys = ON`)).pipe(
    Layer.provideMerge(SqliteClient.layer({ filename })),
  );
  return Layer.mergeAll(FloorDatabase.layer, MarketHistorySql).pipe(Layer.provide(schema), Layer.provide(sqlite));
};

/** @stability unstable */
export const localDatabaseLayer = Layer.unwrap(Effect.gen(function*() {
  const filename = yield* Config.String("FLOOR_DATABASE").pipe(Config.withDefault(".data/floor.sqlite"));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
  return databaseLayer(filename);
}));
