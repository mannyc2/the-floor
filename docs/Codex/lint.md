# Lint and compiler requirements

The workspace keeps strict native TypeScript options and all 91 explicit Effect error diagnostics. `prepare` applies `effect-tsgo patch --typescript --oxlint`. Exact dependency pins are in the root manifest and lockfile. Runtime globals are confined to the relevant app or tooling configuration; the root has no ambient Workers types or path aliases.

`@floor/api` is the sole internal unstable-API export exception. Its HTTP definition derives from contract Schemas. Reviewed external module families remain explicitly listed; application code receives no broad exception. Effect 4 uses stability tags and paths such as `effect/ai`, `effect/http-api` and `effect/sql`.

`bun run lint` compiles the custom plugin, runs type-aware Oxlint with the Effect presets and web-only Foldkit rules, scans HTML/CSS visual values, and checks the per-file suppression budget. Every native suppression must have a concrete reason. ESLint disable aliases are ignored by Oxlint and rejected by the budget scanner. Changes to counts in `scripts/lint/suppression-budget.json` require review; updating the count alone is not justification.

The custom rules cover imports, re-exports, literal and computed dynamic imports, type imports and CommonJS boundaries in app/package production source. Positive and negative fixtures exercise:

- Contract's Effect-only boundary and app/feature ownership.
- Chain-neutral Schema definitions outside the Solana and EVM adapter directories: no hex-specific patterns, numeric slot/block-number fields or chain-native units. Ordinary `block` labels, multiplier/dimension strings and palette slot names remain valid.
- Signer exclusion of model, agent and Floor dependencies.
- Three.js confined to web.
- Production exclusion of testing exports, fixture/workbench code and file reads or copies that bypass imports.
- Atlas ownership of colour and pixel literals in strings, templates, HTML and CSS. Approved generated exceptions remain unavailable until their manifest exists.
- Exclusion of retired effect-cf, web3.js/Anchor/BN and the full Meteora SDK from production.
- Exclusion of the Privy SDK, `svix` and `@hpke/*` from every production graph; Privy's `/solana-kit` helper is forbidden even in tests. The native wallet client is checked against a development-only SDK oracle.

Build checks independently inspect the reachable emitted module graph and every source map. A full AST parser rejects computed module dependencies; literal dynamic imports and re-exports are traversed. Missing or empty maps fail, except the individually hashed reviewed bundler helper. Nonempty `sourceRoot` fails closed rather than changing source authority invisibly. Web modules must also appear in the Vite manifest. Production bundle checks cover actual web, Floor and chain artifacts; the signer target is tested with negative fixtures until a signer app exists.

The Privy oracle fence was verified on 13 October 2026 with `bun test ./scripts/lint/test ./scripts/bundle-budget/test`: 25 tests and 1,276 assertions passed. The emitted-graph fixtures check bundled sources and unbundled dependencies behind seven static, re-export, dynamic and CommonJS forms for web, Floor and signer, with clean native-client controls. A scratch-copy audit detected all 15 disabled guards, with passing baseline and restored runs; its raw results remain under `work/privy-fence-mutations/`.

Bundle budgets remain data: 200 KiB initial and 180 KiB deferred gzip. The complete profile is the web build default and requires a deferred renderer entry. The shell profile remains available only for bundle-check fixtures.

`work/` and generated dependency output are outside active source checks. Renderer source, the development workbench and their tests all receive the full checks. Explicit root test paths keep Bun's substring test discovery away from them. Do not weaken these boundaries to make a check pass.
