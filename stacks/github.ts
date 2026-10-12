import * as Alchemy from "alchemy";
import { currentProfileName } from "alchemy/Auth/Profile";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import { Config, Effect, Layer, Redacted, Schema } from "effect";
import { requireAdminProfile, requireSelectedAccount } from "./_lib/policy";

// Only this separately selected profile can mint CI authority. The preview token
// has no token-creation permission and is scoped to the owner's selected account.
export default Alchemy.Stack(
  "FloorGitHub",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function*() {
    yield* Schema.decodeUnknownEffect(Schema.Literal("admin"))(yield* Alchemy.Stage).pipe(Effect.orDie);
    yield* requireAdminProfile(yield* currentProfileName.pipe(Effect.orDie)).pipe(Effect.orDie);
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    yield* requireSelectedAccount(accountId).pipe(Effect.orDie);
    const owner = yield* Config.String("FLOOR_GITHUB_OWNER");
    const repository = yield* Config.String("FLOOR_GITHUB_REPOSITORY");
    const token = yield* Cloudflare.ApiToken.AccountApiToken("PreviewToken", {
      name: "floor-preview-ci",
      accountId,
      policies: [{
        effect: "allow",
        // A fresh CI runner recovers state credentials through an ephemeral
        // Worker secret binding. Cloudflare's metadata-only Read cannot bind.
        permissionGroups: ["Workers Scripts Write", "Secrets Store Write"],
        resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
      }],
    });
    // Alchemy keys resources by logical ID across provider types. Reusing the
    // token's ID would return that resource and silently skip the GitHub secret.
    const tokenSecret = yield* GitHub.Secret("PreviewTokenSecret", {
      owner,
      repository,
      name: "CLOUDFLARE_API_TOKEN",
      value: token.value,
    });
    const accountSecret = yield* GitHub.Secret("AccountId", {
      owner,
      repository,
      name: "CLOUDFLARE_ACCOUNT_ID",
      value: Redacted.make(accountId),
    });
    yield* GitHub.Variable("PreviewConfigured", {
      owner,
      repository,
      name: "FLOOR_PREVIEW_CONFIGURED",
      value: Output.map(Output.all(tokenSecret.updatedAt, accountSecret.updatedAt), () => "true"),
    });
    return { repository: `${owner}/${repository}` };
  }),
);
