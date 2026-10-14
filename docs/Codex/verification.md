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

Use Bun 1.4.0. The frozen install verifies the pinned tarballs against `bun.lock` and keeps the compiler/Oxlint patch in `prepare`. `typecheck` runs one `tsc -b` over the eleven project references with the strict options and all 91 Effect diagnostics. `test` runs the explicit leaf paths; native Worker tests and browser flows have their own commands so CI stops at the first failed acceptance step.

Until the Atlas cleanup lands, intentional Atlas source edits require `bun scripts/build-atlas.ts` and review of the generated changes. Style lint and builds verify the committed source/output manifest without regenerating it. Never substitute a Bun server build for Workers: `build` uses Alchemy's local Worker harness, alongside the web and chain builds and their artifact fences.

## Local checks

One Playwright config, `testing/flows/playwright.config.ts`, owns the `shell` and `renderer` projects. `bun run e2e` runs both serially. The shell flow enters the real local Alchemy Worker through its web UI and checks the health RPC at `POST /api/rpc` and discovers and calls the read-only health MCP tool at `/mcp`; it has no model, authentication or network stubs, and its promise is connectivity only. SIGTERM finalization removes the local stage. Playwright retains videos and final screenshots under `work/flows/`.

The renderer project runs the separately built development workbench. Its behavior, camera, picking, replay, ownership and phone assertions remain required. The finished tone/proportion studies and 360-capture matrix are retired; the `/look/` adapter and scene loading remain for asset work. Approved-frame checks arrive with the asset branch and use `toHaveScreenshot` at zero tolerance; reference images cannot be replaced without the owner's pick.

Only one browser suite may run on the machine at a time. If another checkout owns the renderer port, select a free port with `FLOOR_RENDERER_PORT`, for example `FLOOR_RENDERER_PORT=5185 bun run e2e`. The validated port controls the browser, server and readiness probe together; the default is 5180 and an occupied listener is never reused. A project can be selected with `bun run e2e --project renderer` or `--project shell`.

The default renderer is SwiftShader. The phone profile is 390×844 at DPR 3 with 4× CPU throttling and keeps its 16.7 ms renderer CPU budget. It is a desktop profile, not evidence from a real phone. `FLOOR_PHONE_RENDERER=apple bun run e2e --project renderer --grep "configured phone profile"` is a separate local measurement and cannot replace the default check. Sustained streams record wall-clock arrival lateness as a measurement; every revision, deterministic upload budgets and the 16.7 ms per-frame CPU limit remain asserted.

Native agent tests use a labelled scripted model. Decisions and wallet leaf tests use fake HTTP transports; the wallet test preload blocks external Fetch and off-host redirects. Recorded data remains labelled replay data. Each flow must enter through production, avoid arranging the state it asserts, assert the named product promise, label stubs and recordings, and receive a second reviewer. Use request-hashed recorded model responses that fail on unknown requests. Evidence comes from this repository's own runs, and full-day flow claims require fresh full-day data for its chain.

## CI and hosted acceptance

The required sequence is:

1. Formatting, types and lint; no later acceptance step runs after a failure.
2. Leaf tests, production builds, native tests and local browser flows.
3. Alchemy preview deployment, then the production-entry flow against that stage.
4. Camera and deterministic look checks, the phone-profile bench and retained flow recordings. The current renderer project runs locally on the CI runner; it does not prove hosted renderer behavior. Stage 0's production-entry hosted camera flow remains pending integration and its owner gate.
5. Verified teardown on close, including failed runs and partial deployment.

`FLOOR_FLOW_URL` selects the shell's target and `FLOOR_FLOW_REMOTE=true` omits its local Worker. The renderer project still serves the workbench locally. Hosted shell success and local renderer success are separate evidence.

Preview deployment requires both `FLOOR_PREVIEW_ENABLED` and the single admitted `FLOOR_PREVIEW_PR`; cleanup is independently gated by `FLOOR_PREVIEW_CONFIGURED`. The procedure, queueing rules and spending limits are in [the platform](../platform.md). Cleanup checks out only the trusted default branch and rejects non-PR stage names before loading credentials. Fork PRs receive no deployment secrets. No production deployment is enabled. Recheck the allowance and explicitly admit one PR before enabling deployment.

`FLOOR_UPLOAD_ARTIFACTS` stays off until GitHub's separate storage allowance is verified; without uploads, runner-created recordings expire with the job. Local captures against previews are separate executions, not retained CI recordings. Actions remain pinned to verified Node 24 releases.

Put each result and its command or CI run link in the commit or pull request body, including failures and measurement limits. Raw logs and captures belong in ignored `work/`. Local verification does not close the hosted, art or Stage 0 owner gates.
