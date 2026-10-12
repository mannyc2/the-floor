# Verification

Preparation contains no application code. Check source-document hashes, link targets, reserved directories, and the reference snapshot (`cd reference && shasum -a 256 -c MANIFEST.sha256`). These checks do not establish runtime compatibility or Stage 0 completion.

Once Stage 0 establishes the build, these commands are required:

```sh
bun run format:check
bun run typecheck
bun run lint
bun run build
```

Use Bun 1.4.0 and a fresh lockfile containing the dependencies actually adopted. Verify installation with `bun install --frozen-lockfile`. Keep the compiler/Oxlint patch in `prepare`. Never carry over the old Bun server build as a substitute for Workers.

The implementation CI sequence is fixed by the technical design:

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
