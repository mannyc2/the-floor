# Platform

How the Floor runs on Cloudflare, how preview CI works, what hosted work may spend, and the provider checks still open.

## Built on Alchemy

Alchemy v2 is how the Floor is written for Cloudflare, not only how it is deployed. Its runtime is Effect-native, so Workers, Durable Objects and their bindings are Effect services and Layers. There is no Wrangler config and no `effect-cf`. If Alchemy can't do something, record it in the [decision log](decisions.md) rather than dropping down to Wrangler.

- **Stacks.** `alchemy.run.ts` is the Floor: one Worker that serves the API, holds the agent and mailbox Durable Objects, and serves the built web app as its assets. `stacks/github.ts` is a separate stack that provisions CI credentials. The signer will be its own stack, deployed separately and reached through a typed cross-stack reference.
- **Workers and Durable Objects** are `Cloudflare.Worker` and `Cloudflare.DurableObject`. Their outer Effect runs at plan time as well as at runtime, so it has no side effects. Bindings come in as Layers.
- **Scheduled work** uses durable callbacks (`Alchemy.makeCallback`), scheduled inside a storage transaction so the write and the job commit together. Delivery is at least once, so side effects carry idempotency keys.
- **The agent's Durable Object** is Yielded's Alchemy platform, from the pinned build in `vendor/yielded/`. It hosts Yielded's thread object in an Alchemy `DurableObject`.
- **Storage.** Durable Object SQL through `Cloudflare.SqlMigrations`, and D1 through Alchemy's SQL integration. Their transactions differ, so never hide them behind one interface.
- **Browsers.** The `Cloudflare.Browser` binding gives quick actions such as `screenshot`, for plates. Its raw binding feeds Yielded's Cloudflare adapter, for agents' sessions.
- **Docs.** Find the page you need in [llms.txt](https://alchemy.run/llms.txt); the [Cloudflare tutorial](https://alchemy.run/cloudflare/tutorial/part-1), parts 1 to 5, covers the basics. Read the installed package source before choosing an API.

## Running it

- **Locally.** `bun run dev` runs `alchemy dev --stage dev`. Workers run in local workerd, but state is remote, so it needs the owner's profile and can create hosted resources. `bun run dev:web` runs only the web shell.
- **Tests.** Native tests use Alchemy's harness with local state (`Test.make({ dev: true })`) and a fetch guard that allows only loopback, so they need no profile and touch nothing hosted.
- **Deploys** happen only through preview CI. There is no production deployment.

## Credentials

Credentials are Alchemy profiles in `~/.alchemy`, never environment files or the repository:
- **The owner's Cloudflare profile,** connected through Alchemy's OAuth flow for the selected personal account. It is used by `bun run dev` and hosted tests.
- **`floor-admin`,** a stored token that can also create API tokens (Account API Tokens Write). Only `bun run ci:configure`, which applies `stacks/github.ts`, uses it.

Both keep remote state in the account-wide `alchemy-state-store` Worker. It is shared, pre-existing infrastructure at version 7, which matches beta.80. Never upgrade, replace or destroy it automatically, and run tests with `updateStateStore: false`.

## Preview CI

`.github/workflows/ci.yml` runs formatting, types, lint, leaf tests, builds, native tests and the browser flow. For one admitted pull request it also deploys a `pr-<number>` stage and runs the flow against it, then comments the URL. `cleanup.yml` destroys that stage when the PR closes. It checks out only the trusted default branch and rejects any stage name that isn't `pr-<number>`. Both workflows queue per PR, and a new run never replaces a pending cleanup.

Three repository variables gate it:
- `FLOOR_PREVIEW_CONFIGURED` is `true` once `bun run ci:configure` has installed the scoped token and account id as secrets. Cleanup needs it.
- `FLOOR_PREVIEW_ENABLED` turns deployment on. It is `false` now.
- `FLOOR_PREVIEW_PR` names the one PR allowed to deploy. It is cleared now.

To run a preview:
1. Check the remaining allowance (see [Spending](#spending)).
2. Set `FLOOR_PREVIEW_PR` to the PR's number, then set `FLOOR_PREVIEW_ENABLED` to `true`.
3. When you're done, set `FLOOR_PREVIEW_ENABLED` to `false` before closing the PR. Keep `FLOOR_PREVIEW_CONFIGURED`, the credentials and the admitted number until cleanup has run and the resources are confirmed gone.
4. Drain queued runs before changing the admission. Changing a variable doesn't stop a job that is already running.

A manual run without `preview_pr` performs the checks only. With `preview_pr`, the number must match the admitted, open, same-repository PR at the dispatched commit, so it tests the PR's head rather than GitHub's merge revision. Fork PRs get no deployment secrets, and closing one can't start cleanup. The cleanup workflow can also be dispatched by hand for a valid `pr-<number>` stage.

Proved on 12 October 2026: [CI run 38295404123](https://github.com/mannyc2/the-floor/actions/runs/38295404123) deployed `pr-1` and passed the hosted flow, and closing the PR ran [cleanup 38296179460](https://github.com/mannyc2/the-floor/actions/runs/38296179460). An inventory comparison confirmed every owned resource gone and every pre-existing one unchanged.

## Spending

Hosted work uses only the included allowance of the owner's $5 Workers Paid plan, on the selected personal account. These need the owner's approval first: a new subscription, any overage, R2, and any separately billed provider (inference, wallets, market data).

For each hosted run:
- Check the account's remaining allowance first. Dashboard figures are rounded and lag, so a reading straight after a run can't show its exact cost.
- Use one temporary stage, with a stated resource list, for at most 30 minutes and within a stated request budget.
- Destroy it in a finalizer, even after a failure, then confirm by inventory that every owned resource is gone and every pre-existing one is unchanged.
- Don't use Browser Run until the billing cycle's remaining browser allowance is known (the plan includes 10 browser-hours a month), and then only one browser at a time.

On 12 October the account was far inside its allowance: about 41,000 of 10 million Worker requests and 42 of 1 million Durable Object requests for the cycle. The two hosted runs so far (the native agent check and the `pr-1` preview) made no Browser Run, R2 or paid-provider calls.

## Proved on Cloudflare

- **The agent's Durable Object:** durable callback admission, an agent turn with a scripted model, restart and duplicate admission, locally and on a hosted stage.
- **Storage:** Durable Object and D1 initialisation, rollback, conditional writes and persistence, locally and hosted.
- **Web Crypto** for the operations the Floor uses, on a hosted stage.
- **Deploy and destroy** through preview CI.

Not yet proved: live model calls, hosted agent eviction, browsers, wallets and plates. Those are the checks below.

## Open provider checks

None of these blocks Stage 0. Each runs in the stage that first needs it: the browser, wallets and inference in Stage 3, before an agent first browses or trades, and plates in Stage 5. Each provider stays behind its own service and Layer, so the choice stays cheap until then.

Each check runs against the real provider, within the spending limits and with the owner's approval for any paid provider. Its result goes in the decision log with the run or command that shows it. A local, mocked or import-only result doesn't count.

### The agent's browser

Prove an agent's browser session from inside its Durable Object: page capture, and an interactive navigation the agent drives. Prove that the desk's drawer can show the live session and that the owner can take it over, and observe idle expiry and reconnection.

Containment is the open decision. Cloudflare's adapter rejects `PublicWeb` before it starts a session, so choose one of these, test it against controlled endpoints (prohibited destinations and redirects), and record it:
- a deny-by-default host allowlist, saying what it rules out;
- `Unrestricted` behind the Floor's own enforcement, with the rules and the points that enforce them tested;
- open-web sessions on another provider (Browserbase, through effect-browserbase, is the fallback Layer), keeping Cloudflare only where its policy holds.

A model instruction isn't network enforcement, and an unrestricted session is never called `PublicWeb`. Local Chromium, through effect-browser, is for development and flows only.

### Wallets

In Privy's sandbox, using the native client in [`packages/wallets`](../packages/wallets/README.md): create an agent's wallet, set a two-of-two key quorum with the signer, confirm a policy, sign an allowed transaction, and see a disallowed one refused. Sandbox value only: no real funds, mainnet broadcast or real launch. The client signs requests correctly in tests, but nothing has reached the sandbox yet.

### Live inference

Call the selected Anthropic and OpenAI models through their Layers, including the Decisions adapter, within a budget the owner sets. Inference never enters the signer.

### Plates

Have Browser Rendering screenshot a bounded scene from the real renderer, recording the renderer revision, scene, camera, viewport and image digest. It needs a hosted run of the renderer, and it checks the platform, not the art.

### Market data

When Stage 3 needs it, connect a Codex (codex.io) market-data account, read through its own service edge, for the tokens agents hold or are working on.
