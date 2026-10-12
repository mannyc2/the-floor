import { BunServices } from "@effect/platform-bun";
import { AlchemyContext, AlchemyContextLive } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStoreLive } from "alchemy/Auth/Profile";
import * as Cloudflare from "alchemy/Cloudflare";
import { deploy } from "alchemy/Deploy";
import { destroy } from "alchemy/Destroy";
import { Interaction, layerNonInteractive } from "alchemy/Interaction";
import { State } from "alchemy/State";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { PreviewStage } from "../../stacks/_lib/policy";

const platform = Layer.mergeAll(
  BunServices.layer,
  FetchHttpClient.layer,
  Layer.provide(ProfileStoreLive, BunServices.layer),
  Layer.provide(CredentialsStoreLive, BunServices.layer),
);

// This follows beta.80's Test/Core and CLI composition without the CLI's --yes
// override: AlchemyContextLive keeps updateStateStore=false. A prompt fails
// through NonInteractiveTerminal; CI cannot approve a shared-store upgrade.
const engine = Layer.mergeAll(
  AlchemyContextLive,
  Layer.sync(ArtifactStore, createArtifactStore),
  Layer.succeed(AuthProviders, AuthProviders.of({})),
  layerNonInteractive(),
).pipe(Layer.provideMerge(platform));

// StackEffect keeps an ambient State requirement even though each stack binds
// its own state. Use the same Cloudflare backend, never a local fallback that
// could make cleanup mistake missing state for an already-destroyed preview.
const runtime = Cloudflare.state().pipe(Layer.provideMerge(engine));

type DeploymentServices = AlchemyContext | ArtifactStore | Interaction | State | FileSystem.FileSystem | Path.Path;
const withDeploymentRuntime = <A, E>(operation: Effect.Effect<A, E, DeploymentServices>) =>
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This deployment boundary owns the live engine and platform Layers; callers validate stage before acquisition.
  operation.pipe(Effect.provide(runtime));

export class DeploymentError
  extends Schema.TaggedError<DeploymentError>()("DeploymentError", { cause: Schema.Defect() })
{
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}
const deploymentFailure = (cause: unknown) => new DeploymentError({ cause });
const PreviewOutput = Schema.Struct({
  url: Schema.String.check(Schema.isPattern(/^https:\/\/[^/]+\.workers\.dev\/?$/)),
});
const loadPreviewStack = () => import("../../alchemy.run");
const loadAdminStack = () => import("../../stacks/github");

export const deployPreview = Effect.fn("Preview.deploy")(
  function*(stage: string) {
    // Keep stage admission ahead of module loading and Layer acquisition. Help
    // and rejected input must not read profiles or request authentication.
    const checked = yield* Schema.decodeEffect(PreviewStage)(stage);
    const { default: stack } = yield* Effect.tryPromise({ try: loadPreviewStack, catch: deploymentFailure });
    const result: unknown = yield* withDeploymentRuntime(deploy({ stack, stage: checked }));
    return yield* Schema.decodeUnknownEffect(PreviewOutput)(result);
  },
  Effect.mapError(deploymentFailure),
);

export const destroyPreview = Effect.fn("Preview.destroy")(
  function*(stage: string) {
    const checked = yield* Schema.decodeEffect(PreviewStage)(stage);
    const { default: stack } = yield* Effect.tryPromise({ try: loadPreviewStack, catch: deploymentFailure });
    yield* withDeploymentRuntime(destroy({ stack, stage: checked }));
  },
  Effect.mapError(deploymentFailure),
);

export const configurePreviewCi = Effect.fn("Preview.configureCi")(
  function*(stage: string) {
    const checked = yield* Schema.decodeUnknownEffect(Schema.Literal("admin"))(stage);
    const { default: stack } = yield* Effect.tryPromise({ try: loadAdminStack, catch: deploymentFailure });
    yield* withDeploymentRuntime(deploy({ stack, stage: checked }));
  },
  Effect.mapError(deploymentFailure),
);
