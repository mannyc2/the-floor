# Cleanup plan

15 October 2026. The owner's decisions are the 15 October rows in the [decision log](decisions.md#repository-ci-and-spending). The program halves the moving parts before the Stage 0 branches merge, so later stages build on less. It runs before the [Stage 0 plan](stage-0-plan.md)'s integration, which then resumes on the cleaned `main`.

## Rules

- No features. Each workstream deletes or simplifies; nothing new lands. D1, the renderer-stream merge, is the one exception.
- Keep planned code; cut dead code. Planned code is simplified but stays: the MCP adapter, contract's later-stage schemas, `packages/chains` including `math.ts`, `packages/wallets` and the Decisions adapter. Dead code is code nothing imports and nobody plans to use. Git keeps it.
- The behaviour specs are the guard. A spec may change how it observes, for example counting uploads from a Playwright init script instead of an engine counter, but never what it asserts. Never weaken a check.
- Approved values and frames don't change. A pixel change stops the workstream for the owner.
- Results go in the commit body: commands, pass or fail, and production sLOC before and after. Docs describe what is.
- The Stage 0 plan's [session rules](stage-0-plan.md#rules-for-every-session) still apply: one browser suite at a time, its ports, and no push, deploy, provider call or spend.
- If a behaviour spec fails for a reason you can't explain, stop and report it.

## Baseline and targets

Counted on `main` at `7a3c263`: tracked `.ts`, `.tsx`, `.js`, `.mjs` and `.sql` files outside `vendor/`, excluding blank lines and lines that are only a `//` comment. Targets come from the 15 October audit's enumerated candidates; each workstream measures its actual result with the same method.

| Area | Production now | Target | Tests now | Target |
| --- | --- | --- | --- | --- |
| `apps/web/src` | 2,286 | ~1,600 | 665 | ~365 |
| `apps/web/workbench` | 2,001 | ~1,000 | — | — |
| `packages/atlas` | 531 + 1,362 generated | ~190, none generated | (in `scripts`) | — |
| `packages/chains` | 813 + 746 generated | ~560 + 746 generated | 314 | ~310 |
| `packages/wallets` | 772 | ~480 | 1,534 | ~1,150 |
| `packages/contract`, `world`, `api` | 1,444 | unchanged | 1,871 | unchanged |
| `apps/floor/src` | 631 | ~300 (test Layers move to `test/`) | 725 | ~450 |
| `scripts` | 1,516 | ~400 | 1,242 | ~150 |
| `testing` | — | — | 3,492 | ~1,300 |
| **Hand-written production** (with `stacks`, `alchemy.run.ts`) | **6,565** | **~4,650** | | |

Also: about 8,600 lines of generated `tokens.json`, `atlas.css` and `manifest.json` go to none; 212 suppression directives to about 50; about 30 root scripts to about 12; docs from 348 KB to about 190 KB.

## Order

1. **T** alone first. It changes lint, typecheck and the Playwright config that every other workstream runs.
2. **D1, R and S** in parallel. D1 is the [Stage 0 plan](stage-0-plan.md#d-integration)'s renderer-stream merge: rebase onto T, rerun the full flow with the unchanged limits, merge, nothing more. R and S don't touch the renderer.
3. **K and W** in parallel, after D1. W rebases onto K if K lands first; K owns only the palette lines in `engine.ts`.
4. **Branches:** rebase and slim the remaining Stage 0 branches onto the cleaned `main`. Integration (D2 to D4) then resumes.
5. **Docs** last, describing the result.

Browser slot priority: T, D1, W, K, R.

## T. Tooling

Branch `codex/cleanup-tooling`. Browser slot for the final run.

- `typecheck` becomes one `tsc -b` over project references instead of eleven runs.
- The import fences move into `no-restricted-imports` overrides in `.oxlintrc.json`: contract imports only Effect, three.js stays in web, the signer exclusions, testing and workbench code stay out of production, and the retired and forbidden packages, including the Privy SDK, stay out. Custom rule code remains only for app/feature isolation and the Atlas visual-literal rule. The file-read rules (no production source reads files) and the chain-neutral Schema rule (contract's branded CAIP types carry it) go, with their fixtures.
- Effect rules come from one engine. Keep the 91 compiler diagnostics and turn off only oxlint rules they already enforce. Per-glob overrides for Playwright specs, tests and `runMain` entry files replace the matching inline suppressions.
- The suppression budget (scanner, JSON and test) is replaced by `--report-unused-disable-directives` and a short check that every directive gives a reason.
- Keep the 200 KiB initial and 180 KiB deferred gzip budgets and two artifact fences: the workbench and the Privy SDK stay out of production builds. The rest of `scripts/bundle-budget` goes, including the pinned bundler-helper hash.
- `vendor:verify` goes; `bun install --frozen-lockfile` checks the tarballs' sha512 in `bun.lock`. Keep one copy of the Alchemy patch.
- One Playwright config with projects. The renderer phone and timing checks stay required.
- The finished look rounds leave the suite: `tone-study.spec.ts`, `proportion-study.spec.ts`, the 360-capture `look.spec.ts`, the matrix, metrics and target generator in `testing/look`, and the workbench study modules they drive. Keep the `/look/` capture adapter and scene loading that the asset branches use.
- `apps/floor/test/hosted.run.ts` and its crypto fixture go (a dated 12 October probe).
- Root scripts come down to about a dozen: `format`, `format:check`, `lint`, `typecheck`, `test`, `test:native`, `build`, `e2e`, `dev`, `dev:web`, `preview`, `preview:destroy`, `ci:configure`. CI and `docs/Codex/{lint,verification}.md` match.
- Keep: the strict tsconfig, the `effect-tsgo` patch in `prepare`, the Alchemy patch, CI's pinned actions and fork guards, the `local-only.ts` loopback guard and dprint.

**Done when:** the full sequence passes with unchanged behaviour assertions, and the commit body gives the suppression count and the `scripts` and `testing` line counts against the baseline.

## K. Atlas

Branch `codex/cleanup-atlas`. Browser slot for one renderer run.

- `packages/atlas/src` holds plain `as const` values. The approval wrapper (status, date, decision link, brief, scope, reason) and the duplicate wrapped and plain exports go. A one-line comment says why only where a value isn't obvious.
- `generated/` goes (`palette.ts`, `tokens.json`, `atlas.css`, `manifest.json`), with `scripts/build-atlas.ts`, `scripts/atlas/`, the manifest check, `atlas-approvals.test.ts` and the generated-output tests. One snapshot test pins the approved values.
- Since D1 the engine writes its RGBA8 palette straight from the sRGB hex values, so the generated linear arrays have no renderer consumer. Keep that byte path; show the palette bytes are identical before and after, and say so in the commit body.
- `index.html` drops its link to `atlas.css`; CSS variables arrive with the interface.
- Scene briefs in `testing/look/scenes/` keep what renders a frame. Their approval and provenance fields go; the decision log's look rows already state each pick and its scope.
- Afterwards the production web build contains no `docs/decisions` or `testing/look/scenes` paths and no approval text.
- The `packages/atlas` row in `docs/Codex/file-structure.md` and `docs/atlas.md` describe the plain values.

**Done when:** palette bytes match, the full sequence passes, and `packages/atlas` is about 190 lines.

## W. Web map

Branch `codex/cleanup-map`. Browser slot.

- Delete `lease-pool.ts`, `transactional-host.ts`, `contracts.ts`, the unused parts of `model.ts`, `test/protocols.test.ts` and `workbench/reconciliation-probe.ts`. The reconciliation spec's 2,000-step test drives the deleted host through that probe and goes with it; W re-adds the memory-to-baseline assertion against the instance path D1 merged. The partial-acquisition test stays.
- Renderer-stream's slimming, merged in D1: its upload wrapper and frame observers leave the production frame loop for the test page or workbench, and its interpolation replaces the old gauge path rather than running beside it. The stream's deterministic budgets and CPU limit must still pass.
- One `Semaphore` permit is held for the scoped renderer's lifetime, with the mounted renderer in a `Ref<Option<…>>` and native failure delivered through a `Deferred` the mount awaits. This replaces `serial-owner.ts`, `display-gate.ts` and the `poisoned`, `paused`, `lost` and `closed` flags. `ScopedRef.set` doesn't fit: it acquires the new value before releasing the old one. Quarantine behaviour stays.
- The engine exposes `camera`, `draw`, `pick` and `apply`, plus one workbench-only internals handle. Leak, listener and upload counting move to Playwright `addInitScript` wrappers. `preserveDrawingBuffer` is set only where the workbench reads pixels back.
- Test controls move to the workbench, which wraps the map with `Update.foldChild` as `src/main.ts` already does: the seven diagnostic messages and the Model fields `order`, `visible`, `acquireDelay`, `applied` and `cameraCommits`. `status` becomes a tagged union.
- The DevTools replay bridge moves to the workbench, since production never enables DevTools. The replay spec stays.
- Camera gestures become one `Motion` union (`Idle`, `Drag`, `Pinch`, `Flight`, `Glide`) instead of flags, and the camera is held in one place.
- Engine resources use `acquireRelease` and `Scope.addFinalizer` instead of a private finalizer stack. `MapFault.phase` becomes a literal union.
- One attribute-geometry helper serves the scene and the workbench.
- Keep: the camera maths, GPU picking, the lazy three.js import, the Vite split, the `cameraFromQuery` boundary and the synthetic scene label (12 October row).

**Done when:** every remaining renderer behaviour spec passes with unchanged assertions, and `apps/web/src` is about 1,600 lines.

## R. Floor runtime

Branch `codex/cleanup-floor`. Browser slot for the shell flow (Worker port 19740).

- The `admissions` table uses Effect SQL instead of raw `sql.exec` strings: the installed `@effect/sql-sqlite-do` client, or Alchemy's `SqlMigrations`, which the test probe already uses. Check in installed source which one binds to the Durable Object's storage. The schema lives in a migration, not an inline `CREATE TABLE IF NOT EXISTS`.
- `completed_at` is nullable and decodes to `Option`; `0` no longer means "not done".
- The thread snapshot returns typed records: `Option` for output and settlement, and the record's `_tag` as a literal union. These replace `{ absent: true }`, `"none"` and `Schema.String`. Use `DateTime` past the boundary, encoding at the RPC edge only if structured clone needs it.
- `orDie` stays only where a failure is a defect; storage and decode failures become one tagged error.
- Decisions stays (12 October row). Its input is validated once, at `PredicateRequest`. There is one translation: the adapter raises `AiError` as the `DecisionModel` contract requires, and the service maps it once to `DecisionFailure`. The custom reason subclasses go if `AiError` can carry the cause, and so do the repeated name checks.
- `src/testing` (scripted model, storage probe, test Worker) moves to `test/`, and the `./testing` export and its lint carve-out go.

**Done when:** `test:native` (admission, restart, gate, decisions) and the shell flow pass with unchanged assertions, including the admission settlement promise.

## S. Chains and wallets

Branch `codex/cleanup-chains-wallets`. No browser slot.

- **Wallets:** one request pipeline (execute, decode, scope, timeout, one `classify`) replaces `decodeResponse`, `complete`, `wrap` and `classifyFailure`. `PrivyFailure` keeps status and code and drops the free-text `kind` and `detail`.
- Base URL and auth are set once with `HttpClient.mapRequest`. Ids are decoded once, at the caller, as branded types, reusing contract's brands where the rules match. The expiry is encoded once.
- The unused probes and wallets' `./testing` export go. P256's test-only `generate`, `signRaw` and `verifyRaw` move to a test helper.
- Wallet tests share one fake-fetch fixture (keep the abort-aware deadline one) and one `fromDer`, with no duplicate canonical-JSON or redaction cases. `offline-fetch.test.ts` and the preload stay as they are; changing them is the owner's call under the incident record.
- **Chains:** construction returns the transaction bytes and the signer list. Tests decode them with Kit's `getTransactionDecoder` and `decompileTransactionMessage` instead of reading `instructions`, `dataHex` and `pdas`. The constant `attachedSignatures: 0` and `quoteOwner` go. EVM takes Base's chain id as a type rather than checking it again at runtime. Program ids are exported once from chains.
- Codama's own `before: [deleteNodesVisitor]` configuration replaces the 185-line regex post-processor. Keep the IDL checksum check. If the generated bytes change, revert.
- `chains/src/testing` moves to `test/`.
- Keep: `math.ts` and its oracle, the Kit, Codama, Doppler and native Privy choices, the digest and IDL-role tests, and the SDK oracle tests.

**Done when:** the leaf tests and the chains digest pass, with sLOC in the commit body.

## Branches

After the cleanup lands, rebase each remaining branch onto `main` and slim it:

- **`codex/renderer-stream`:** merged as D1 after T; its slimming is W's.
- **`codex/asset-kit`:** the workbench calls `makePost` and `makeStation` directly. The committed GLB models, manifests, codec, pipeline and their checks go until a modelled asset exists, and so does the JSON scene that mirrors code. Preflight keeps only the rule run. Approved frames use Playwright's `toHaveScreenshot` with zero tolerance. No approval labels remain in models or code, and the branch's committed-models decision row goes.
- **`codex/shading-options`:** a `SIDE_MODE` define in `shaders.ts` replaces patching GLSL text, and a contact sheet for the owner's pick replaces the 48-case suite. After the pick, the losing mode is deleted.
- **`codex/rpc-api`:** rebase only. The MCP adapter stays as it is.
- **`codex/hosted-renderer-flow`:** rebase after rpc-api, onto the single Playwright config.
- **`codex/world-layout-proposal`:** rebase. It stays unchanged until the owner adopts it.

## Docs

Doc-only, after the code lands.

- `stage-0.md` keeps what's done and what's left; its verification narratives go.
- Decision rows keep the decision and its reason; run results leave the Why column.
- `stage-1.md`, `atlas.md` and `look.md` drop finished-round and audit narratives.
- `stage-0-plan.md` keeps only the open workstreams. The README's status stays short.

**Done when:** docs are about 190 KB and nothing in them is a run log.

## Closing the program

The program is done when every workstream has landed, the full sequence passes on `main`, and the table above is re-measured with the same method. Stage 0's finish line is unchanged by this program.
