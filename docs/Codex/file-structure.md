# File structure

Deployables live under `apps/`; code shared by at least two apps, or isolated by a required fence, lives under `packages/`. Each implemented package has its own `package.json`, explicit exports and `./testing` export when it supplies test Layers. Remove packages with no production importers. Reserved directories in this preparation do not justify creating unused packages.

| Location | Responsibility |
| --- | --- |
| `apps/web` | Foldkit client: world, search, drawer, Renderer and Camera services, and development-only workbench |
| `apps/floor` | Worker and world/agent Durable Objects; world, agents, commons, board, pieces, owners, stream, surfaces and settings |
| `apps/signer` | Separate Worker for co-signing, journal and dispatch; no model dependencies |
| `packages/contract` | Schemas, chain-neutral references, settings definitions and defaults; Effect-only imports |
| `packages/api` | HTTP/RPC definitions from contract Schemas |
| `packages/chains` | Chain, venue and launchpad adapters shared by floor and signer |
| `packages/wallets` | Wallet provider service shared by floor and signer |
| `packages/world` | World model: plots, layout, and the piece kit's types and checks; no three.js |
| `packages/atlas` | Tokens, materials, look, camera, motion, scales, proportions, chrome and asset/scene Schemas; no three.js |
| `assets` | Asset sources and manifests, including reproducible generated models |
| `testing` | Flows, look scenes, approved reference frames, bench, recordings and fixtures |
| `scripts` | Build, lint, budget and verification tooling |
| `stacks` | Infrastructure helpers composed by the root `alchemy.run.ts` |
| `reference` | Read-only snapshots of the first build and the cafe reference, with provenance and checksums; excluded from every tool, never imported or read by code |

Organize application source by the feature that uses it, not by technical mechanism. Keep each service interface and Layer together. Use `_components/` and `_lib/` for feature-local helpers. Import relatively inside a feature and through `@floor/<package>` for shared code. Never import across sibling features or between apps.

App and package leaf tests live in their own `test/`; test Layers live in `src/testing/`. Cross-package tests use public exports, never relative imports into another package's source. A package's tests do not depend on flow fixtures.

The future workbench is `apps/web/workbench/`; reference scene specs are `testing/look/scenes/`; approved frames are `testing/reference/`. Create the remaining Atlas and web files from the look spike's recorded picks and the external renderer integration. The owner has picked seven provisional reference frames; tones, proportions and the remaining look acceptance are open. The `world` and `atlas` directories remain reservations until their boundaries are implemented.

Keep `docs/the-floor.md` and `docs/technical-design.md` current. Record decisions and their reasons in `docs/decisions.md`; where they disagree, the decision log wins and the current doc gets fixed. `docs/archive/` and the read-only source snapshots are history, not implementation guidance. Preserve historical evidence with its original inputs and scope. Keep scratch output in `work/`, which git ignores. Commit spike evidence under `docs/spikes/evidence/` as its README describes.
