# Verification

Run these checks before every implementation commit, in order:

```sh
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun run lint
bun run test
bun run build
bun run test:native
bun run e2e
```

Use Bun 1.4.0. The frozen install verifies the pinned tarballs against `bun.lock` and keeps the compiler/Oxlint patch in `prepare`. `typecheck` runs one `tsc -b` over the workspace project references with the strict options and all 91 Effect diagnostics. `test` runs the explicit leaf paths; native Worker tests and browser flows have their own commands so CI stops at the first failed acceptance step.

Atlas source edits must preserve the recorded value snapshot unless the owner changes a pick. Never substitute a Bun server build for Workers: `build` uses Alchemy's local Worker harness, alongside the web and chain builds and their artifact fences. The signer build starts its separate Worker and checks emitted source maps for model, provider and Floor application modules.

## Local checks

One Playwright config, `testing/flows/playwright.config.ts`, owns the `shell`, `first-trade` and `renderer` projects. `bun run e2e` runs them serially. The shell flow enters the real local Alchemy Worker through its web UI and checks the health RPC at `POST /api/rpc` and discovers and calls the read-only health MCP tool at `/mcp`; it has no model, authentication or network stubs, and its promise is connectivity only. SIGTERM finalization removes the local stage. Playwright retains videos and final screenshots under `work/flows/`.

The `shell` project also runs the production camera flow, `production-renderer.spec.ts`, against the same target. With real pointer and touch input on the production page, it checks that world pixels move during a drag without a URL or history change, that release commits one URL and history entry with no duplicate, that a quarter turn survives reload with identical canvas pixels, that double-click zoom and Escape reach the next rung, and that touch at 390×844/DPR 3 moves the world without scrolling. It reads only the URL, DOM text and composited canvas captures with the overlays hidden; there is no workbench adapter or arranged state. A pick check then opens the seeded synthetic world and clicks the first desk through GPU picking: the drawer must show `synthetic-agent` and its refused `synthetic-receipt` with the fixture's synthetic reason, and the click must not commit the camera. The world comes from a separate test-built seed Worker that the local Worker server, like CI on a preview, deploys beside the Floor and calls with a per-run secret; it writes the native world test's labelled fixture through a cross-script binding, and the production Worker gains no route. The shared fixture forwards real same-origin requests one hop at a time without retries or redirects, under one worker's cap of 500 browser and 20 direct requests, and retains receipts, captures and browser logs under `work/flows/results/`. The world stream's open NDJSON response is forwarded natively, still counted, and any redirect status fails the flow.

The first-trade flow owns its local fork, signer and agent Worker through `scripts/first-trade.ts`. It substitutes only the labelled scripted model and disposable fork key, then enters the production viewer. It observes real state changes and active-screen pixels, opens the desk through GPU picking, compares the drawer's receipt to the agent result, checks its transaction and checkpoint on the fork, and proves receipt recovery after reconnect and reload. It asserts that the browser reports no unexpected errors, allowing only the offline network error during its deliberate disconnection. `bun run e2e --project first-trade` selects this flow. It is local-only: `FLOOR_FLOW_REMOTE=true` omits the project and its fixture server.

The renderer project runs the separately built development workbench. Its behavior, camera, picking, replay, ownership and phone assertions remain required. The finished tone/proportion studies and 360-capture matrix are retired; the `/look/` adapter and scene loading remain for asset work. Approved-frame checks arrive with the asset branch and use `toHaveScreenshot` at zero tolerance; reference images cannot be replaced without the owner's pick.

Only one browser suite may run on the machine at a time. Select free local ports with `FLOOR_RENDERER_PORT` (default 5180) and `FLOOR_WORKER_PORT` (default 19740), for example `FLOOR_RENDERER_PORT=5185 FLOOR_WORKER_PORT=19746 bun run e2e`. Both overrides validate as ports and keep each server, readiness probe and default browser target together. An occupied listener is never reused or terminated. A project can be selected with `bun run e2e --project renderer` or `--project shell`. `FLOOR_FLOW_URL` overrides the `shell` project's target, and `FLOOR_FLOW_REMOTE=true` omits its local Worker and the first-trade project and stops at the first failure.

The default renderer is SwiftShader. The phone profile is 390×844 at DPR 3 with 4× CPU throttling and keeps its 16.7 ms renderer CPU budget. It is a desktop profile, not evidence from a real phone. `FLOOR_PHONE_RENDERER=apple bun run e2e --project renderer --grep "configured phone profile"` is a separate local measurement and cannot replace the default check. Sustained streams record wall-clock arrival lateness as a measurement; every revision, deterministic upload budgets and the 16.7 ms per-frame CPU limit remain asserted.

`bun run test:native` also deploys the Floor and seed Workers on local workerd: the seed refuses missing or wrong secrets, writes the fixture idempotently into the Floor's own world stream, and a destroy through a Floor-only stack definition removes both Workers' recorded state. It also runs the fork signer suite. Its installer verifies the pinned Surfpool archive, clones program accounts through public read-only RPC, and runs the fork offline. Native tests submit real fork transactions, check settled token balances, refuse an excessive-slippage trade, reject a mismatched genesis, and settle a deliberately discarded submission response without rebroadcasting. `bun run test:signer` selects only this suite.

The same native command includes `bun run test:first-trade`, which starts and stops the real fork and signer around the agent/world integration test. It checks the settled outcome, ordered world history and identical-intent retry without a duplicate trade or receipt. `bun run dev:first-trade` serves the production viewer with the local test trigger for manual inspection. Startup refuses occupied ports before replacing fixture metadata; shutdown owns only the processes started by that run.

Native agent tests use a labelled scripted model. Decisions and wallet leaf tests use fake HTTP transports; the wallet test preload blocks external Fetch and off-host redirects. Recorded data remains labelled replay data. Each flow must enter through production, avoid arranging the state it asserts, assert the named product promise, label stubs and recordings, and receive a second reviewer. Use request-hashed recorded model responses that fail on unknown requests. Evidence comes from this repository's own runs, and full-day flow claims require fresh full-day data for its chain.

## CI and hosted acceptance

The required sequence is:

1. Formatting, types and lint; no later acceptance step runs after a failure.
2. Leaf tests, production builds, native tests and local browser flows.
3. Alchemy preview deployment, then the production-entry flow against that stage.
4. Camera and deterministic look checks, the phone-profile bench and retained flow recordings. The renderer project runs locally on the CI runner and does not prove hosted renderer behavior; the `shell` project's production camera and pick flows are the hosted renderer check, run after CI seeds the preview, and they have not yet run against a deployed stage.
5. Verified teardown on close, including failed runs and partial deployment.

`FLOOR_FLOW_URL` selects the `shell` project's target and `FLOOR_FLOW_REMOTE=true` omits its local Worker and the first-trade project. The renderer project still serves the workbench locally. Hosted production-entry success and local renderer success are separate evidence. The [run sheet](../platform.md#hosted-renderer-run-sheet) gives the hosted run's resources, budget and teardown.

Preview deployment requires both `FLOOR_PREVIEW_ENABLED` and the single admitted `FLOOR_PREVIEW_PR`; cleanup is independently gated by `FLOOR_PREVIEW_CONFIGURED`. The procedure, queueing rules and spending limits are in [the platform](../platform.md). Cleanup checks out only the trusted default branch and rejects non-PR stage names before loading credentials. Fork PRs receive no deployment secrets. No production deployment is enabled. Recheck the allowance and explicitly admit one PR before enabling deployment.

`FLOOR_UPLOAD_ARTIFACTS` stays off until GitHub's separate storage allowance is verified; without uploads, runner-created recordings expire with the job. Local captures against previews are separate executions, not retained CI recordings. Actions remain pinned to verified Node 24 releases.

Put each result and its command or CI run link in the commit or pull request body, including failures and measurement limits. Raw logs and captures belong in ignored `work/`. Local verification does not close the hosted, art or Stage 0 owner gates.
