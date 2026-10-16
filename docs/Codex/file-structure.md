# File structure

Deployables live under `apps/`; code shared by at least two apps, or isolated by a required fence, lives under `packages/`. Each implemented package has its own `package.json`, and explicit exports. Remove packages with no production importers unless a fence needs their boundary or the owner has planned them. Rows marked *planned* don't exist yet: create them with their first real code, never as empty placeholders.

| Location | Responsibility |
| --- | --- |
| `apps/web` | Foldkit client: world, search, drawer, Renderer and Camera services, and the development-only workbench |
| `apps/floor` | Worker and world/agent Durable Objects; world, agents, commons, board, pieces, owners, stream, surfaces and settings |
| `apps/signer` | *Planned.* Separate Worker for co-signing, journal and dispatch; no model dependencies |
| `packages/contract` | Schemas, chain-neutral references, settings definitions and defaults; Effect-only imports |
| `packages/api` | One RPC group from contract Schemas, with a separate server-only MCP adapter export |
| `packages/chains` | Chain, venue and launchpad adapters shared by floor and signer |
| `packages/wallets` | Wallet provider service shared by floor and signer |
| `packages/world` | World model: desks, plots, layout, and the piece kit's types and checks; no three.js |
| `packages/atlas` | Plain tokens, materials, look, camera and proportions; no generated output or three.js. Approval history lives in the decision log. Other design-system modules and asset/scene Schemas remain planned |
| `assets` | *Planned.* Asset sources and manifests, including reproducible generated models |
| `testing` | Flows, look scenes, approved reference frames, bench, recordings and fixtures |
| `scripts` | Build, lint, budget and verification tooling |
| `stacks` | Infrastructure helpers composed by the root `alchemy.run.ts` |
| `vendor` | Pinned builds of unpublished dependencies, with provenance |

Organize application source by the feature that uses it, not by technical mechanism. Keep each service interface and Layer together. Use `_components/` and `_lib/` for feature-local helpers. Import relatively inside a feature and through `@floor/<package>` for shared code. Never import across sibling features or between apps.

App and package leaf tests, test Layers and fixtures live in their own `test/`. Cross-package tests use public exports, never relative imports into another package's source. A package's tests do not depend on flow fixtures.

The workbench is `apps/web/workbench/`; reference scene specs are `testing/look/scenes/`; approved frames go in `testing/reference/`. The map host and renderer live under `apps/web/src/map`. Workbench diagnostics and edge-projection tools cannot enter the production import graph. The Atlas values come from the owner's recorded visual picks (see `docs/look.md`).

Keep `docs/the-floor.md` and `docs/technical-design.md` current. Record decisions and their reasons in `docs/decisions.md`; where they disagree, the decision log wins and the current doc gets fixed. Put results in commit or pull request bodies, and keep raw output in `work/`, which git ignores.
