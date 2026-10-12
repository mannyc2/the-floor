# Verification

The active Stage 0 skeleton has local production artifacts and runtime checks. Immutable spike and promoted-runtime attempts retain their source manifests, hashes and limitations. Historical snapshot checks do not establish current runtime compatibility or Stage 0 completion.

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

Use Bun 1.4.0 and a fresh lockfile containing the dependencies actually adopted. Verify installation with `bun install --frozen-lockfile`. Keep the compiler/Oxlint patch in `prepare`. Never carry over the old Bun server build as a substitute for Workers.

The local shell flow enters the real Alchemy Worker and checks `/api/health` through its web UI. It has no model, authentication or network stubs; its promise is connectivity only. The native agent tests inject a labelled scripted model at `./testing`; Decisions leaf tests use a fake HTTP transport. Production-entry review confirmed that the shell flow neither arranges its asserted state nor claims unimplemented product behavior. Playwright retains a video and final screenshot, and SIGTERM finalization removes the local stage.

The full implementation CI sequence is fixed by the technical design:

1. Formatting, types and lint; no later acceptance step runs after a failure.
2. Leaf and property tests.
3. Local flows against forks and recorded providers, entering through production. Build their production artifacts before running them.
4. Alchemy preview deployment, then the same flows against the stage.
5. Camera and deterministic look tests against the stage, with affected frames presented for human sign-off.
6. Phone-profile bench with renderer CPU measurements and the comparison table.
7. Retained flow recordings for review.
8. Verified teardown when the pull request closes; cleanup must also handle failed runs and partial deployment.

Each flow must enter through production, avoid arranging the state it asserts, assert the named product promise, label stubs and recordings, and receive a second-person review. Use request-hashed recorded model responses that fail on unknown requests. Stage 0 needs one real flow on its deployed stage; later stages add the promises in the design.

The look harness must pin renderer backend, viewport, DPR, fonts, time and randomness. Its references need named human approval. The phone profile is 390×844 at DPR 3 with 4× CPU throttling; it is not proof of performance on a real phone. Preserve measurement limits with each report.

Never report historical tests or screenshots as evidence for this new workspace. The old Base day has swap windows only in its last six snapshots; record fresh full-day data per island in Stage 3 before claiming full-day flow coverage.

Current preview deployment is gated by `FLOOR_PREVIEW_ENABLED`; cleanup is independently gated by `FLOOR_PREVIEW_CONFIGURED`. Both serialize per PR without replacing queued cleanup. Cleanup checks out only the trusted default branch and rejects non-PR stage names before loading credentials. No production deployment is enabled. Hosted creation, deployed flow and cleanup proof remain separate from local verification.

Exactly one PR must also match `FLOOR_PREVIEW_PR` at both deployment checks. Its admission cannot move to another PR until resources and queued runs are cleared. Automatic cleanup excludes forks. `FLOOR_UPLOAD_ARTIFACTS` defaults off until GitHub's separate storage allowance is verified; runner-created recordings then expire with the job. Record any local capture against the preview as a separate execution, not as a retained CI recording. GitHub actions are pinned to verified Node 24 releases.
