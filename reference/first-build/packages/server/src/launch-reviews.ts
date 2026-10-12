import { type Proposal } from "@floor/contract";
import { LaunchContent, LaunchGate, LaunchGateResult } from "@floor/gate";
import { fingerprintProposal } from "@floor/signing";
import { Context, Crypto, Effect, Layer, Option, Schema } from "effect";
import { Hex } from "effect/encoding";
import { SqlSchema } from "effect/sql";
import { FloorDatabase } from "./store";

export type LaunchProposal = Extract<Proposal, { readonly action: "launch" }>;
export const LaunchReviewRecord = Schema.Struct({
  proposalId: Schema.String,
  proposalFingerprint: Schema.String,
  inputHash: Schema.String,
  imageHash: Schema.OptionFromNullOr(Schema.String),
  content: LaunchContent,
  result: LaunchGateResult,
});
export type LaunchReviewRecord = typeof LaunchReviewRecord.Type;
export class LaunchReviewError extends Schema.TaggedError<LaunchReviewError>()("LaunchReviewError", {
  message: Schema.String,
}) {}

const makeLaunchEvidence = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  const crypto = yield* Crypto.Crypto;
  const read = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Schema.Struct({ data: Schema.fromJsonString(LaunchReviewRecord) }),
    execute: proposalId => db.sql`SELECT data FROM launch_reviews WHERE proposalId = ${proposalId}`,
  });
  const save = SqlSchema.void({
    Request: Schema.Struct({ proposalId: Schema.String, data: Schema.fromJsonString(LaunchReviewRecord) }),
    execute: row =>
      db.sql`INSERT INTO launch_reviews ${
        db.sql.insert(row)
      } ON CONFLICT(proposalId) DO UPDATE SET data = excluded.data`,
  });
  const hash = (value: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(Effect.map(Hex.encode));
  const content = Effect.fn("LaunchReviews.content")(function*(proposal: LaunchProposal) {
    const thesis = yield* db.theses.findById(proposal.thesisId);
    const notes = yield* Effect.forEach([...new Set(thesis.noteIds)], id => db.notes.findById(id));
    if (
      thesis.agentId !== proposal.agentId || notes.length === 0
      || notes.some(note =>
        note.agentId !== proposal.agentId || note.marketId !== thesis.marketId
        || note.sources.length === 0 || (note.status !== "verified" && note.status !== "sourced")
      )
      || proposal.sourceIds.length === 0
      || !proposal.sourceIds.every(id => notes.some(note => note.sources.some(source => source.id === id)))
    ) {
      return yield* new LaunchReviewError({
        message: "A launch review needs this agent's sourced thesis and matching persisted notes.",
      });
    }
    const draft = proposal.id.startsWith("launch:")
      ? yield* db.launches.findById(proposal.id.slice("launch:".length)).pipe(
        Effect.asSome,
        Effect.catchTag("NoSuchElementError", () => Effect.succeedNone),
      )
      : Option.none();
    if (Option.exists(draft, value => value.owner !== proposal.owner || value.agentId !== proposal.agentId)) {
      return yield* new LaunchReviewError({ message: "The launch declaration belongs to another owner or desk." });
    }
    return {
      launch: proposal.launch,
      declaration: Option.match(draft, { onNone: () => "", onSome: value => value.thesis }),
      thesis,
      notes,
    } satisfies LaunchContent;
  });
  const inputHash = Effect.fn("LaunchReviews.inputHash")(function*(proposal: LaunchProposal, value: LaunchContent) {
    const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(LaunchContent))(value);
    return yield* hash(`launch-gate-v1\n${fingerprintProposal(proposal)}\n${encoded}`);
  });
  const accepted = Effect.fn("LaunchReviews.accepted")(function*(proposal: LaunchProposal) {
    const stored = yield* read(proposal.id);
    if (Option.isNone(stored)) return false;
    const record = stored.value.data;
    if (
      record.proposalFingerprint !== fingerprintProposal(proposal) || record.result.status !== "accepted"
      || Option.isNone(record.result.image) || Option.isNone(record.imageHash)
      || record.result.checks.some(check => check.status !== "pass")
    ) return false;
    const current = yield* content(proposal);
    return record.inputHash === (yield* inputHash(proposal, current));
  }, Effect.orElseSucceed(() => false));
  const record = Effect.fn("LaunchReviews.record")(
    function*(proposal: LaunchProposal, value: LaunchContent, result: LaunchGateResult) {
      const evidenceRecord: LaunchReviewRecord = {
        proposalId: proposal.id,
        proposalFingerprint: fingerprintProposal(proposal),
        inputHash: yield* inputHash(proposal, value),
        imageHash: Option.isSome(result.image) ? Option.some(yield* hash(result.image.value.image)) : Option.none(),
        content: value,
        result,
      };
      yield* save({ proposalId: proposal.id, data: evidenceRecord });
      return evidenceRecord;
    },
    Effect.mapError(() =>
      new LaunchReviewError({
        message: "The launch review evidence could not be completed or stored. Nothing was authorized.",
      })
    ),
  );
  return {
    content,
    record,
    accepted,
    read: (proposalId: string) => read(proposalId).pipe(Effect.map(Option.map(row => row.data))),
  };
});

// Signing reads persisted evidence through this service; it cannot acquire or invoke an inference provider.
/** @stability unstable */
export class LaunchReviewEvidence
  extends Context.Service<LaunchReviewEvidence, Effect.Success<typeof makeLaunchEvidence>>()(
    "floor/LaunchReviewEvidence",
  )
{
  static readonly layer = Layer.effect(LaunchReviewEvidence, makeLaunchEvidence);
}

/** @stability unstable */
export class LaunchReviews extends Context.Service<LaunchReviews, {
  review(proposal: LaunchProposal): Effect.Effect<LaunchReviewRecord, LaunchReviewError>;
}>()("floor/LaunchReviews") {
  static readonly layer = Layer.effect(
    LaunchReviews,
    Effect.gen(function*() {
      const evidence = yield* LaunchReviewEvidence;
      const gate = yield* LaunchGate;
      return LaunchReviews.of({
        review: Effect.fn("LaunchReviews.review")(
          function*(proposal) {
            const value = yield* evidence.content(proposal);
            const result = yield* gate.review(value);
            return yield* evidence.record(proposal, value, result);
          },
          Effect.mapError(() =>
            new LaunchReviewError({
              message: "The launch review evidence could not be completed or stored. Nothing was authorized.",
            })
          ),
        ),
      });
    }),
  );
}
