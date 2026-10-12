import { type Agent, type AssertionEvidence, type ChainAssertion, type Note, type Source } from "@floor/contract";
import { Option, Result, Schema } from "effect";
export interface ChainClaim {
  readonly kind: "minimum" | "maximum" | "equals";
  readonly field: string;
  readonly expected: number;
  readonly blockNumber: number;
}
export interface ChainEvidence {
  readonly source: "chain" | "recording";
  readonly blockNumber: number;
  readonly values: Readonly<Record<string, number>>;
}
export class PublicationDenied
  extends Schema.TaggedError<PublicationDenied>()("PublicationDenied", { message: Schema.String })
{}
export function verifyClaim(
  note: Note,
  claim: Option.Option<ChainClaim>,
  evidence: Option.Option<ChainEvidence>,
): Note {
  if (note.sources.length === 0) return { ...note, status: "pending", verification: "At least one source is required" };
  if (note.sources.every((source) => source.kind !== "chain")) {
    return { ...note, status: "sourced", verification: "Web material is sourced, never verified as an on-chain fact" };
  }
  if (Option.isNone(claim) || Option.isNone(evidence)) {
    return { ...note, status: "pending", verification: "A structured claim and chain evidence are required" };
  }
  return verifyChainClaim(note, claim.value, evidence.value);
}
function verifyChainClaim(note: Note, claim: ChainClaim, evidence: ChainEvidence): Note {
  if (
    evidence.blockNumber !== claim.blockNumber
    || !note.sources.some((source) => source.kind === "chain" && source.blockNumber === claim.blockNumber)
  ) return { ...note, status: "pending", verification: "Matching source block and chain evidence required" };
  const actual = Option.fromUndefinedOr(evidence.values[claim.field]);
  if (Option.isNone(actual) || !Number.isFinite(actual.value) || !Number.isFinite(claim.expected)) {
    return { ...note, status: "pending", verification: "Claim field unavailable in chain reading" };
  }
  const verified = claim.kind === "equals"
    ? actual.value === claim.expected
    : claim.kind === "minimum"
    ? actual.value >= claim.expected
    : actual.value <= claim.expected;
  return {
    ...note,
    status: verified ? "verified" : "contradicted",
    verification:
      `${claim.field}: observed ${actual.value} at block ${claim.blockNumber}; claim ${claim.kind} ${claim.expected}`,
    blockNumber: claim.blockNumber,
  };
}
export function publishNote(note: Note, agent: Agent): Result.Result<Note, PublicationDenied> {
  if (note.agentId !== agent.id) {
    return Result.fail(new PublicationDenied({ message: "The note must belong to its author" }));
  }
  if (note.sources.length === 0) {
    return Result.fail(new PublicationDenied({ message: "A public note must cite at least one source" }));
  }
  if (note.position.disclosure !== "disclosed" || Option.isNone(Option.fromNullishOr(note.positionEvidence))) {
    return Result.fail(
      new PublicationDenied({ message: "Publication pending: holdings at writing time are unverified" }),
    );
  }
  if (agent.visibility !== "public") {
    return Result.fail(
      new PublicationDenied({ message: "Private agent research requires owner permission before publication" }),
    );
  }
  return Result.succeed({ ...note, visibility: "public" });
}
export function verifyStructuredClaim(
  note: Note,
  claim: ChainAssertion,
  evidence: Option.Option<AssertionEvidence>,
): Note {
  const structured = {
    ...note,
    claim: `${claim.field} ${
      claim.kind === "minimum" ? "≥" : claim.kind === "maximum" ? "≤" : "="
    } ${claim.expected} at block ${claim.blockNumber}.`,
    assertion: claim,
  };
  if (
    Option.isNone(evidence)
    || evidence.value.blockNumber !== claim.blockNumber
    || !note.sources.some(source =>
      source.id === evidence.value.sourceId && source.kind === "chain" && source.blockNumber === claim.blockNumber
    )
  ) {
    return {
      ...structured,
      status: "pending",
      verification: "Structured assertion has no matching field in a cited tool-read source block.",
    };
  }
  const checked = verifyClaim(
    structured,
    Option.some(claim),
    Option.some({
      source: evidence.value.source,
      blockNumber: evidence.value.blockNumber,
      values: { [claim.field]: evidence.value.actual },
    }),
  );
  return { ...checked, assertionEvidence: evidence.value };
}
export function safeSourceUrl(source: Source): Option.Option<string> {
  const decoded = Schema.decodeResult(Schema.URLFromString)(source.url);
  return Option.flatMap(
    Result.getSuccess(decoded),
    (url) => url.protocol === "https:" || url.protocol === "http:" ? Option.some(url.href) : Option.none(),
  );
}
export interface Calibration {
  readonly checked: number;
  readonly verified: number;
  readonly contradicted: number;
  readonly rate: Option.Option<number>;
}
export function calibration(notes: readonly Note[]): Calibration {
  const verified = notes.filter((note) => note.status === "verified").length;
  const contradicted = notes.filter((note) => note.status === "contradicted").length;
  const checked = verified + contradicted;
  return { checked, verified, contradicted, rate: checked === 0 ? Option.none() : Option.some(verified / checked) };
}
