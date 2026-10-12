import { Agent, Brief, FloorEvent, Note, Plate, Proposal, Receipt, ScribedLine, Thesis, Thread } from "@floor/contract";
import { MarketSlot } from "@floor/districts";
import { AgentActivity, DesignSubmission, LaunchDraft, Owner } from "@floor/surfaces";
import { Context, Effect, Layer, Option, Order, Schema } from "effect";
import { Model } from "effect/schema";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";

/** @stability unstable */
export class OwnerRow extends Model.Class<OwnerRow>("OwnerRow")(Owner.fields) {}
/** @stability unstable */
export class AgentRow extends Model.Class<AgentRow>("AgentRow")({
  ...Agent.fields,
  emblem: Schema.fromJsonString(Agent.fields.emblem),
  policy: Schema.fromJsonString(Agent.fields.policy),
  budget: Schema.fromJsonString(Agent.fields.budget),
  publishMandate: Model.BooleanSqlite,
  paused: Model.BooleanSqlite,
}) {}
/** @stability unstable */
export class NoteRow extends Model.Class<NoteRow>("NoteRow")({
  ...Note.fields,
  sources: Schema.fromJsonString(Note.fields.sources),
  position: Schema.fromJsonString(Note.fields.position),
  positionEvidence: Schema.fromJsonString(Note.fields.positionEvidence),
  assertion: Schema.fromJsonString(Note.fields.assertion),
  assertionEvidence: Schema.fromJsonString(Note.fields.assertionEvidence),
}) {}
/** @stability unstable */
export class ThesisRow extends Model.Class<ThesisRow>("ThesisRow")({
  ...Thesis.fields,
  noteIds: Schema.fromJsonString(Thesis.fields.noteIds),
}) {}
/** @stability unstable */
export class ThreadRow extends Model.Class<ThreadRow>("ThreadRow")({
  ...Thread.fields,
  marketIds: Schema.fromJsonString(Thread.fields.marketIds),
}) {}
/** @stability unstable */
export class BriefRow extends Model.Class<BriefRow>("BriefRow")({
  ...Brief.fields,
  receiptIds: Schema.fromJsonString(Brief.fields.receiptIds),
  noteIds: Schema.fromJsonString(Brief.fields.noteIds),
}) {}
/** @stability unstable */
export class ProposalRow extends Model.Class<ProposalRow>("ProposalRow")({
  id: Model.Field({ select: Schema.String, update: Schema.String }),
  data: Schema.fromJsonString(Proposal),
}) {}
// Receipt phases are a discriminated contract. SQLite derives the key from the validated payload so it cannot diverge.
/** @stability unstable */
export class ReceiptRow extends Model.Class<ReceiptRow>("ReceiptRow")({
  id: Model.Field({ select: Schema.String, update: Schema.String }),
  data: Schema.fromJsonString(Receipt),
}) {}
/** @stability unstable */
export class AlertRow
  extends Model.Class<AlertRow>("AlertRow")({ ...ScribedLine.fields, crossed: Model.BooleanSqlite })
{}
/** @stability unstable */
export class PlateRow extends Model.Class<PlateRow>("PlateRow")({
  ...Plate.fields,
  number: Model.Field({ select: Schema.Int, update: Schema.Int }),
  receiptIds: Schema.fromJsonString(Plate.fields.receiptIds),
  image: Schema.String,
}) {}
/** @stability unstable */
export class DesignRow extends Model.Class<DesignRow>("DesignRow")({
  ...DesignSubmission.fields,
  design: Schema.fromJsonString(DesignSubmission.fields.design),
  checks: Schema.fromJsonString(DesignSubmission.fields.checks),
}) {}
/** @stability unstable */
export class LaunchRow extends Model.Class<LaunchRow>("LaunchRow")(LaunchDraft.fields) {}
/** @stability unstable */
export class ActivityRow
  extends Model.Class<ActivityRow>("ActivityRow")({ ...AgentActivity.fields, untrusted: Model.BooleanSqlite })
{}
/** @stability unstable */
export class EventRow extends Model.Class<EventRow>("EventRow")({
  ...FloorEvent.fields,
  payload: Schema.fromJsonString(FloorEvent.fields.payload),
}) {}
/** @stability unstable */
export class ChallengeRow extends Model.Class<ChallengeRow>("ChallengeRow")({
  id: Schema.String,
  owner: Schema.String,
  message: Schema.String,
  expiresAt: Schema.Int,
}) {}
/** @stability unstable */
export class SessionRow
  extends Model.Class<SessionRow>("SessionRow")({ id: Schema.String, owner: Schema.String, expiresAt: Schema.Int })
{}

const makeDatabase = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;
  const publicNote =
    sql`n.visibility = 'public' AND a.visibility = 'public' AND json_type(n.positionEvidence) = 'object' AND json_extract(n.position, '$.disclosure') = 'disclosed' AND json_array_length(n.sources) > 0`;
  const owners = yield* SqlModel.makeRepository(OwnerRow, {
    tableName: "owners",
    idColumn: "id",
    spanPrefix: "Owners",
  });
  const agents = yield* SqlModel.makeRepository(AgentRow, {
    tableName: "agents",
    idColumn: "id",
    spanPrefix: "Agents",
  });
  const notes = yield* SqlModel.makeRepository(NoteRow, { tableName: "notes", idColumn: "id", spanPrefix: "Notes" });
  const theses = yield* SqlModel.makeRepository(ThesisRow, {
    tableName: "theses",
    idColumn: "id",
    spanPrefix: "Theses",
  });
  const threads = yield* SqlModel.makeRepository(ThreadRow, {
    tableName: "threads",
    idColumn: "id",
    spanPrefix: "Threads",
  });
  const briefs = yield* SqlModel.makeRepository(BriefRow, {
    tableName: "briefs",
    idColumn: "id",
    spanPrefix: "Briefs",
  });
  const proposalRows = yield* SqlModel.makeRepository(ProposalRow, {
    tableName: "proposals",
    idColumn: "id",
    spanPrefix: "Proposals",
  });
  const proposalsByAgent = SqlSchema.findAll({
    Request: Schema.String,
    Result: ProposalRow,
    execute: id => sql`SELECT * FROM proposals WHERE json_extract(data, '$.agentId') = ${id} ORDER BY rowid`,
  });
  const proposalById = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ProposalRow,
    execute: id => sql`SELECT * FROM proposals WHERE id = ${id}`,
  });
  const receipts = yield* SqlModel.makeRepository(ReceiptRow, {
    tableName: "receipts",
    idColumn: "id",
    spanPrefix: "Receipts",
  });
  const alerts = yield* SqlModel.makeRepository(AlertRow, {
    tableName: "alerts",
    idColumn: "id",
    spanPrefix: "Alerts",
  });
  const plates = yield* SqlModel.makeRepository(PlateRow, {
    tableName: "plates",
    idColumn: "number",
    spanPrefix: "Plates",
  });
  const designs = yield* SqlModel.makeRepository(DesignRow, {
    tableName: "designs",
    idColumn: "id",
    spanPrefix: "Designs",
  });
  const launches = yield* SqlModel.makeRepository(LaunchRow, {
    tableName: "launches",
    idColumn: "id",
    spanPrefix: "Launches",
  });
  const activity = yield* SqlModel.makeRepository(ActivityRow, {
    tableName: "activity",
    idColumn: "agentId",
    spanPrefix: "Activity",
  });
  const events = yield* SqlModel.makeRepository(EventRow, {
    tableName: "events",
    idColumn: "id",
    spanPrefix: "Events",
  });
  const challenges = yield* SqlModel.makeRepository(ChallengeRow, {
    tableName: "challenges",
    idColumn: "id",
    spanPrefix: "Challenges",
  });
  const sessions = yield* SqlModel.makeRepository(SessionRow, {
    tableName: "owner_sessions",
    idColumn: "id",
    spanPrefix: "Sessions",
  });
  return {
    sql,
    owners: {
      ...owners,
      findByWallet: SqlSchema.findOneOption({
        Request: Schema.String,
        Result: OwnerRow,
        execute: address => sql`SELECT * FROM owners WHERE walletAddress = ${address}`,
      }),
    },
    agents: {
      ...agents,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: AgentRow,
        execute: () => sql`SELECT * FROM agents ORDER BY createdAt, id`,
      }),
    },
    notes: {
      ...notes,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: NoteRow,
        execute: () => sql`SELECT * FROM notes ORDER BY createdAt, id`,
      }),
      listPublic: SqlSchema.findAll({
        Request: Schema.Void,
        Result: NoteRow,
        execute: () =>
          sql`SELECT n.* FROM notes n JOIN agents a ON a.id = n.agentId WHERE ${publicNote} ORDER BY n.createdAt`,
      }),
    },
    theses: {
      ...theses,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: ThesisRow,
        execute: () => sql`SELECT * FROM theses ORDER BY createdAt, id`,
      }),
      listPublic: SqlSchema.findAll({
        Request: Schema.Void,
        Result: ThesisRow,
        execute: () =>
          sql`SELECT t.* FROM theses t JOIN agents author ON author.id = t.agentId
          WHERE author.visibility = 'public' AND json_array_length(t.noteIds) > 0
          AND NOT EXISTS (SELECT 1 FROM json_each(t.noteIds) cited
            WHERE NOT EXISTS (SELECT 1 FROM notes n JOIN agents a ON a.id = n.agentId
              WHERE n.id = cited.value AND n.agentId = t.agentId AND n.marketId = t.marketId AND ${publicNote}))
          ORDER BY t.createdAt, t.id`,
      }),
    },
    threads: {
      ...threads,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: ThreadRow,
        execute: () => sql`SELECT * FROM threads ORDER BY createdAt, id`,
      }),
    },
    briefs: {
      ...briefs,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: BriefRow,
        execute: () => sql`SELECT * FROM briefs ORDER BY date, id`,
      }),
      listPublic: SqlSchema.findAll({
        Request: Schema.Void,
        Result: BriefRow,
        execute: () =>
          sql`SELECT b.* FROM briefs b JOIN agents author ON author.id = b.agentId
          WHERE b.visibility = 'public' AND author.visibility = 'public' AND json_array_length(b.noteIds) > 0
          AND NOT EXISTS (SELECT 1 FROM json_each(b.noteIds) cited
            WHERE NOT EXISTS (SELECT 1 FROM notes n JOIN agents a ON a.id = n.agentId
              WHERE n.id = cited.value AND n.agentId = b.agentId AND ${publicNote}))
          ORDER BY b.date, b.id`,
      }),
    },
    proposals: {
      insert: Effect.fn("Proposals.insert")((data: Proposal) =>
        proposalRows.insert({ data }).pipe(Effect.map(row => row.data))
      ),
      findById: Effect.fn("Proposals.findById")((id: string) =>
        proposalRows.findById(id).pipe(Effect.map(row => row.data))
      ),
      listByAgent: Effect.fn("Proposals.listByAgent")((id: string) =>
        proposalsByAgent(id).pipe(Effect.map(rows => rows.map(row => row.data)))
      ),
      findByIdOption: Effect.fn("Proposals.findByIdOption")((id: string) =>
        proposalById(id).pipe(Effect.map(Option.map(row => row.data)))
      ),
    },
    receipts: {
      ...receipts,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: ReceiptRow,
        execute: () => sql`SELECT * FROM receipts ORDER BY rowid`,
      }),
      findByProposal: SqlSchema.findOneOption({
        Request: Schema.String,
        Result: ReceiptRow,
        execute: id => sql`SELECT * FROM receipts WHERE json_extract(data, '$.proposalId') = ${id}`,
      }),
    },
    alerts: {
      ...alerts,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: AlertRow,
        execute: () => sql`SELECT * FROM alerts ORDER BY createdAt, id`,
      }),
    },
    plates: {
      ...plates,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: PlateRow,
        execute: () => sql`SELECT * FROM plates ORDER BY number`,
      }),
    },
    designs: {
      ...designs,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: DesignRow,
        execute: () => sql`SELECT * FROM designs ORDER BY createdAt, id`,
      }),
    },
    launches: {
      ...launches,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: LaunchRow,
        execute: () => sql`SELECT * FROM launches ORDER BY createdAt, id`,
      }),
    },
    activity: {
      ...activity,
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: ActivityRow,
        execute: () => sql`SELECT * FROM activity ORDER BY updatedAt`,
      }),
      upsert: SqlSchema.void({
        Request: ActivityRow.insert,
        execute: row =>
          sql`INSERT INTO activity ${sql.insert(row)} ON CONFLICT(agentId) DO UPDATE SET ${
            sql.update(row, ["agentId"])
          }`,
      }),
    },
    events: {
      ...events,
      listForOwner: SqlSchema.findAll({
        Request: Schema.String,
        Result: EventRow,
        execute: owner => sql`SELECT * FROM events WHERE actor = ${owner} ORDER BY rowid DESC LIMIT 100`,
      }),
      listByAgent: SqlSchema.findAll({
        Request: Schema.String,
        Result: EventRow,
        execute: id => sql`SELECT * FROM events WHERE entityId = ${id} ORDER BY rowid`,
      }),
    },
    challenges,
    sessions,
    marketSlots: {
      ensure: Effect.fn("MarketSlots.ensure")((ids: readonly string[]) =>
        sql.withTransaction(
          Effect.forEach(
            [...new Set(ids)].toSorted(Order.String),
            id =>
              sql`INSERT INTO market_slots(marketId, slot) SELECT ${id}, COALESCE(MAX(slot), -1) + 1 FROM market_slots WHERE true ON CONFLICT(marketId) DO NOTHING`,
            { concurrency: 1, discard: true },
          ),
        )
      ),
      list: SqlSchema.findAll({
        Request: Schema.Void,
        Result: MarketSlot,
        execute: () => sql`SELECT marketId, slot FROM market_slots ORDER BY slot`,
      }),
    },
    moorings: {
      list: SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ marketId: Schema.String }),
        execute: owner => sql`SELECT marketId FROM moorings WHERE owner = ${owner} ORDER BY rowid`,
      }),
    },
  };
});

/** @stability unstable */
export class FloorDatabase
  extends Context.Service<FloorDatabase, Effect.Success<typeof makeDatabase>>()("floor/Database")
{
  static readonly layer = Layer.effect(FloorDatabase, makeDatabase);
}
