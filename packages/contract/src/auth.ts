import { Schema } from "effect";

// A provider subject is an authentication identity, not the Floor's persisted OwnerId.
export const PrivySubject = Schema.String.check(Schema.isPattern(/^did:privy:\S+$/));
export const AuthenticatedOwner = Schema.Struct({
  subject: PrivySubject,
  origin: Schema.Literals(["web", "cli"]),
});
export type AuthenticatedOwner = typeof AuthenticatedOwner.Type;

export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()("AuthenticationError", {
  reason: Schema.Literals(["missing_token", "invalid_token"]),
}) {}
