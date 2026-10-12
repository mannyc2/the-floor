# Lint and compiler requirements

These are Stage 0 porting requirements. The new workspace has no active linter or compiler configuration yet. The exact prior pins and source paths are in [reference-sources.json](../reference-sources.json).

Preserve the strict native compiler options, 91 explicit Effect error diagnostics, the Effect presets, and the supported patch command `effect-tsgo patch --typescript --oxlint`. Remove old path aliases and root Workers globals; place runtime-specific types at the appropriate app boundary. Effect 4 uses modules such as `effect/ai`, `effect/http-api` and `effect/sql`, with stability tags rather than `effect/unstable/` paths.

Remove the old Floor paths from `allowedUnstableApis`. Limit the single internal exception to `packages/api` when implemented, as recorded in [the decision log](../decisions.md). Preserve reviewed dependency module families without broadly exempting application code.

Port Oxlint's type-aware rules, Effect presets and rule block. Point the Foldkit override at `apps/web`, and remove the old null-rule overrides. Any suppression needs an explicit reason and a counted budget. The Effect lint plugin is community maintained; Foldkit's plugin is maintained with Foldkit.

Until `reference/` is deleted at the end of Stage 0, exclude it from dprint, oxlint, TypeScript, Vitest, Playwright and every bundle.

Adapt the AST-based custom plugin and its positive/negative tests. It must cover imports, re-exports, dynamic imports, type imports and CommonJS boundaries in both `apps/` and `packages/`. Required fences include:

- Contract imports only Effect and its own modules.
- No app imports another app, and no feature imports a sibling feature.
- Signer excludes inference, agent and Floor dependencies, including transitive bundle contents.
- Three.js appears only in web, including transitive bundle contents.
- Production excludes testing exports, fixture imports and file reads or copies that bypass import checks.
- Nothing outside `reference/` imports or reads from `reference/`.
- Colours and pixel literals follow the Atlas source and generated-output rules.
- Production bundles exclude workbench code.

Reuse the manifest walker as a bundle fence, with budgets represented as data and failures as structured errors. Do not activate the old plugin unchanged: it knows the discarded `packages/frontend` and `packages/signing` layout and does not enforce the new fences.
