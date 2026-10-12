# Renderer source for the map host

These files are renderer source waiting to be ported into the map host, renderer, camera and picking in `apps/web`. They are outside every check and are never imported.

| File | What to take from it |
| --- | --- |
| `renderer.ts` | Technique B: the surface-id-and-depth edge pass and the colour pass. Port B only; A and C were rejected |
| `scene.ts` | The mesh conventions: `_SURFACE` edge ids, `_MAT` palette slots and the kit unit. Its geometry is stand-in test geometry |
| `svg-profiles.ts` | The SVG-profile route: paths turned into points for lathing and extruding |
| `atlas-tokens.json` | A starting palette that `scene.ts` reads. `packages/atlas` replaces it once the look is picked |
| `project-edges.ts`, `export-scene.ts`, `primitive-silhouettes.ts`, `projection.d.ts` | The CPU edge-projection target and the primitive silhouette checks that the [look harness](../../../../testing/look/README.md) consumes. Rebuild them as web-owned test tooling |

The technique's measurements are summarised in [the look](../../../../docs/look.md#the-technique). Delete this folder once `apps/web` has the renderer and the target tooling.
