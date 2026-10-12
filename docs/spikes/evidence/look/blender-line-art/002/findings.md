# Genuine Blender Line Art target, attempt 002

Nine targets executed in Blender 4.5.14 LTS (build 62c1db4208e8) with the shared scene and original orthographic raster cameras. This is technical spike evidence, not art approval.

The targets used for scoring apply a documented workaround: a separate Line Art classification camera rotates by 0.000001 radians around its local Y axis. The raster camera stays unchanged. This is **not exact camera equivalence for visibility classification**. The largest classifier projection change is 0.003076 CSS pixels. Unmodified-camera targets are preserved under the scratch `exact-camera/` folder and should not be treated as complete line ground truth.

Why: the official contour classifier tests opposite face-dot products and then requires their sum to be nonzero. At the scene's exact 45-degree yaw, symmetric faces of the 24-sided cylinders sum to zero, dropping both vertical silhouette edges. An isolated source-cylinder reproduction showed the same failure; the classification epsilon restores the silhouette. This target limitation must remain visible wherever the edge scores are reported. See the [Blender source](https://github.com/blender/blender/blob/v4.5.14/source/blender/modifiers/intern/lineart/lineart_cpu.cc).

A second verified API trap affected the initial width: Blender's field named `radius` is divided by two when it becomes the generated point-radius attribute. Supplying half a world-space CSS pixel produced half-width strokes. The final script supplies one pixel's world-space diameter and records the actual generated point radii. Initial half-width and offset experiments are kept here; they are excluded from scoring.

The script bakes the genuine Grease Pencil LINEART modifier's visible strokes, then hides source meshes for the render. This avoids EEVEE depth competition against coplanar source faces. It never substitutes Freestyle. Black strokes on white make the layer independent of day/night tone choices. Text labels are excluded; scoring must use canvas masks without DOM labels.

Projection validation uses all 13,908 supplied triangle vertices against the float64 three.js matrices. Maximum raster error is below 0.000290 CSS pixels. Nine clean-cylinder line profiles each measure 1.0 CSS pixel at a grayscale threshold of 128. Integrated darkness is 1.005–1.141 CSS pixels. This is a local width check, not an assertion about every line, join or occlusion.

`blender_stall.py` separately authors boxes and 24-sided cylinders from the stall parameters, without reading shared triangles during generation. All three variants export `.blend` and `.glb`; custom `_SURFACE` IDs and `_MAT` palette values are checked in the binary GLB, not just in Blender memory. Triangle counts match 192, 132 and 204. Aligned bidirectional vertex-set error is below 0.00000049 world units. Different coplanar diagonals and absolute surface numbering are permitted; this check does not prove identical topology or normals.

The independent generation/mesh steps took approximately 0.002–0.004 seconds per variant in this run; export timing includes a large first-call initialization effect. These times are machine execution, not agent modelling effort. Pipeline preparation before disk relief took roughly 15 minutes. The resumed pipeline began around 13:23 UTC; independent stall first success was around 13:27 UTC. Subsequent time went to target/API diagnosis and evidence. Active time was not instrumented, so no trustworthy per-asset authoring-labour comparison is claimed.

The official 311,909,763-byte DMG matched SHA256 `65134d9b07b20e2fa8d3c9e44f6f44ffb5c9774dd521b95f50387310241ca170`. Only the local scratch app was extracted; the mounted volume was detached and the task-owned DMG deleted after verification. Peak app-plus-DMG storage was about 1.1 GiB, below the 2 GiB budget. No system application was installed.

Cross-review and the owner's picks remain pending. This evidence does not complete Part A, Part B, or Stage 0.
