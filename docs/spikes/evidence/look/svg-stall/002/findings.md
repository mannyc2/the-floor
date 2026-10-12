# Independent SVG stall route

The three SVG-profile stalls match the original Three generator geometrically and render identically in the measured 64-pixel comparison. This is a technical route comparison, not an art or asset approval.

The SVG implementation authors a closed rectangular path for extrusion and an open radial path for revolution. A deliberately small absolute M/L/Z parser converts those genuine SVG path commands into points. It runs in Bun and the browser without a DOM dependency. The stall module imports the profiles, Atlas tokens and Three's extrusion/revolution machinery; it does not import the existing stall generator or its output. Dimensions and variant contents reproduce the shared stand-in specification. The original generator is imported only by separate validation and comparison modules.

| Variant | Triangles in each route | Unique vertices in each route | Maximum bidirectional vertex error | Semantic boundary edges |
| --- | ---: | ---: | ---: | ---: |
| 1 | 192 | 114 | 0 | 144 |
| 2 | 132 | 88 | 0 | 132 |
| 3 | 204 | 122 | 0 | 156 |

Semantic edge sets agree after coordinates are rounded to 1e-5 world units. Numerical surface IDs and triangle diagonals may differ. Every triangle has a constant positive integer `_SURFACE` and valid integer `_MAT`; palette slots match. Exported BufferGeometry JSON round-trips position, normal, `_SURFACE`, `_MAT` and the provisional kit unit without change.

At 64×64 native pixels, using one orthographic camera, day tokens, technique B and asserted SwiftShader WebGL, every corresponding color PNG has the same SHA-256. All three pairs have zero changed color pixels, zero changed edge-mask pixels and edge IoU 1. The [contact sheet](comparison.png) shows both routes at native size. This does not establish appearance across every angle, theme, zoom or production scene.

The same profile module also provides `M 0.14 0 L 0.26 0.15 L 0.2 0.52 L 0.11 0.62` for the preexisting figure's exact radial points. The parent agent independently verified that switching the figure's input to this path preserved the complete shared scene's SHA-256; it did not introduce new proportions.

Observed SVG authoring and validation elapsed time was **12 minutes 39 seconds**, from 14:09:07 to 14:21:46 UTC on 12 October 2026. This includes common profile/parser preparation, all three variants, the figure helper, export checks, 64-pixel comparisons, required source checks and the final headed demonstration. Work continued on source while the phone-profile benchmark held the browser. This is observed wall time for the shared route task, not instrumented per-variant labor; dividing it by three would invent a per-asset estimate. The original Three generator's authoring time was not instrumented and remains unavailable. Single-run construction times in `geometry-report.json` are runtime observations only and include cold-start effects.

Typecheck, lint and the application build passed. The build retained its existing large-chunk warning. The final headed demonstration passed and closed its browser. An initial contact sheet clipped its footer, and the first headed attempt failed its strict console check on an implicit favicon 404; those diagnostics remain in ignored scratch. The final page includes an explicit empty favicon and a taller capture. No renderer, main entry or scene source was edited by the SVG route author.

Independent technical review by the parent agent passed the route separation, geometry/attribute comparison and native-size contact-sheet checks. The owner's pick remains pending. The parser intentionally accepts only the authored absolute polygonal path subset; curves and arbitrary SVG documents are not supported. No Blender execution is part of this route.
