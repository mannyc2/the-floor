# File structure

Deployables live under `apps/`; code shared by at least two apps, or isolated by a required fence, lives under `packages/`. Each implemented package has its own `package.json`, explicit exports and `./testing` export when it supplies test Layers. Remove packages with no production importers. Reserved directories in this preparation do not justify creating unused packages.

| Location | Responsibility |
| --- | --- |
| `apps/web` | Foldkit client, Renderer and Camera services, screen chrome, plate/review pages and development-only workbench |
| `apps/floor` | Worker and district/agent Durable Objects; districts, agents, record, gate, launches, community, owners, surfaces and settings |
| `apps/signer` | Separate Worker for co-signing, journal and dispatch; no model dependencies |
| `packages/contract` | Schemas, chain-neutral references, settings definitions and defaults; Effect-only imports |
| `packages/api` | HTTP/RPC definitions from contract Schemas |
| `packages/chains` | Chain, venue and launchpad adapters shared by floor and signer |
| `packages/wallets` | Wallet provider service shared by floor and signer |
| `packages/map` | Map model, tiers, layout, orange-part selection, gate checks and drivers; no three.js |
| `packages/atlas` | Tokens, materials, look, camera, motion, scales, proportions, chrome and asset/scene Schemas; no three.js |
| `assets` | Asset sources and manifests, including reproducible generated models |
| `testing` | Flows, look scenes, approved reference frames, bench, recordings and fixtures |
| `scripts` | Build, lint, budget and verification tooling |
| `stacks` | Infrastructure helpers; `alchemy.run.ts` will compose the root stack |
| `reference` | Read-only snapshots of the first build and the cafe reference, with provenance and checksums; excluded from every tool, never imported or read by code |

Organize application source by the feature that uses it, not by technical mechanism. Keep each service interface and Layer together. Use `_components/` and `_lib/` for feature-local helpers. Import relatively inside a feature and through `@floor/<package>` for shared code. Never import across sibling features or between apps.

App and package leaf tests live in their own `test/`; test Layers live in `src/testing/`. Cross-package tests use public exports, never relative imports into another package's source. A package's tests do not depend on flow fixtures.

The future workbench is `apps/web/workbench/`; reference scene specs are `testing/look/scenes/`; approved frames are `testing/reference/`. Create the remaining Atlas and web files only from the look spike's result. The preparation has no palette, camera constants, asset manifests or approved frames.

The copied revised documents are historical inputs. Keep new decisions in `docs/decisions.md`, and identify any corrections without silently rewriting the snapshots. Keep scratch output in `work/`, which git ignores. Commit spike evidence under `docs/spikes/evidence/` as its README describes.
