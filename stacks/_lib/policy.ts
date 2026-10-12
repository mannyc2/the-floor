import { Effect, Schema } from "effect";

export const selectedAccountId = "7aa7065a7e971d97435b3f22098d78b0";
export const PreviewStage = Schema.String.check(Schema.isPattern(/^pr-[1-9][0-9]{0,8}$/));
export const TemporaryStage = Schema.String.check(Schema.isPattern(/^stage0-[a-z0-9]{1,20}$/));
export const ProjectStage = Schema.Union([Schema.Literal("dev"), PreviewStage, TemporaryStage]);

export class DeploymentPolicyError extends Schema.TaggedError<DeploymentPolicyError>()("DeploymentPolicyError", {
  rule: Schema.Literals(["SelectedAccount", "AdminProfile"]),
  observed: Schema.String,
}) {}

export const requireSelectedAccount = (accountId: string) =>
  accountId === selectedAccountId
    ? Effect.void
    : Effect.fail(new DeploymentPolicyError({ rule: "SelectedAccount", observed: accountId }));
export const requireAdminProfile = (profile: string) =>
  profile === "floor-admin"
    ? Effect.void
    : Effect.fail(new DeploymentPolicyError({ rule: "AdminProfile", observed: profile }));
