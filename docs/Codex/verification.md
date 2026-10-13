# Verification

Run these checks before every implementation commit:

```sh
bun run format:check
bun run typecheck
bun run lint
bun run test:leaf
bun run build
bun run test:native
bun run test:flow
```

Use Bun 1.4.0, and verify installation with `bun install --frozen-lockfile`. The lockfile contains only the dependencies actually adopted. Keep the compiler/Oxlint patch in `prepare`. Never substitute a Bun server build for Workers.

The local shell flow enters the real Alchemy Worker and checks `/api/health` through its web UI. It has no model, authentication or network stubs; its promise is connectivity only. The native agent tests inject a labelled scripted model at `./testing`; Decisions and wallet leaf tests use a fake HTTP transport. Production-entry review confirmed that the shell flow neither arranges its asserted state nor claims unimplemented product behavior. Playwright retains a video and final screenshot, and SIGTERM finalization removes the local stage.

The full implementation CI sequence is fixed by the technical design:

1. Formatting, types and lint; no later acceptance step runs after a failure.
2. Leaf and property tests.
3. Local flows against forks and recorded providers, entering through production. Build their production artifacts before running them.
4. Alchemy preview deployment, then the same flows against the stage.
5. Camera and deterministic look tests against the stage, with affected frames presented for the owner's pick.
6. Phone-profile bench with renderer CPU measurements and the comparison table.
7. Retained flow recordings for review.
8. Verified teardown when the pull request closes; cleanup must also handle failed runs and partial deployment.

Each flow must enter through production, avoid arranging the state it asserts, assert the named product promise, label stubs and recordings, and receive a second reviewer. Use request-hashed recorded model responses that fail on unknown requests. Stage 0 needs one real flow on its deployed stage; later stages add the promises in the design.

The look harness must pin renderer backend, viewport, DPR, fonts, time and randomness. Its references need the owner's recorded pick. The phone profile is 390×844 at DPR 3 with 4× CPU throttling; it is not proof of performance on a real phone. Preserve measurement limits with each report.

The complete look pipeline has an 18-minute orchestration deadline inside Effect and a 20-minute runner ceiling, leaving time for scoped child-process cleanup. These bound a hung pipeline; the 360 captures, 20 repetitions per cell, primitive comparisons and separate phone CPU budget of 16.7 ms remain unchanged.

If another checkout owns the renderer test port, set `FLOOR_RENDERER_PORT` to a free local port, for example `FLOOR_RENDERER_PORT=5185 bun run test:flow`. The validated port controls the browser, server and readiness probe together; the default remains 5180 and an occupied listener is never reused.

Evidence for this repository comes from its own runs, never from another codebase's tests or screenshots. Record fresh full-day data for the floor's chain before claiming full-day flow coverage.

Preview deployment is gated by `FLOOR_PREVIEW_ENABLED` and the single admitted PR in `FLOOR_PREVIEW_PR`; cleanup is independently gated by `FLOOR_PREVIEW_CONFIGURED`. The procedure, the queueing rules and the spending limits are in `docs/platform.md`. Cleanup checks out only the trusted default branch and rejects non-PR stage names before loading credentials. Fork PRs receive no deployment secrets. No production deployment is enabled. Hosted creation, deployed flow and cleanup proof remain separate from local verification.

`FLOOR_UPLOAD_ARTIFACTS` defaults off until GitHub's separate storage allowance is verified; runner-created recordings then expire with the job. Record any local capture against a preview as a separate execution, not as a retained CI recording. GitHub actions are pinned to verified Node 24 releases.

The first hosted proof ran on 12 October 2026: [CI](https://github.com/mannyc2/the-floor/actions/runs/38295404123) deployed `pr-1` and passed the typed-health flow, and closing the PR ran [trusted cleanup](https://github.com/mannyc2/the-floor/actions/runs/38296179460). An inventory comparison confirmed owned resources gone and baseline metadata unchanged. Later work must recheck the allowance and explicitly admit its one PR before enabling deployment.
