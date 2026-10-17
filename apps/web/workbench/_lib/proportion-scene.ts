import { cameraValues, proportionCameraValues } from "@floor/atlas/camera";
import { type PaletteName, proportionPalette } from "@floor/atlas/materials";
import { figureHeight, roomyRecipe, studyCounts, studyLayout } from "@floor/atlas/proportions";
import { Effect, Option } from "effect";
import * as THREE from "three";
import { chairParts, figureParts, type FigurePose } from "../../src/map/_lib/assets/figure";
import type { Camera } from "../../src/map/model";
import type { Engine } from "../renderer-probe";
import { WorkbenchFailure } from "../runtime";
import {
  box,
  createProportionGeometry,
  type Part,
  part,
  type Point,
  type ProportionGeometry,
} from "./proportion-geometry";

// The picked Roomy post, floor, cast and readability views. Their geometry is
// fixed: the preserved reference frames must reproduce from it byte for byte.
type ProportionView = "post" | "floor" | "cast" | "readability";

export const proportionCamera = (view: ProportionView, height: number): Camera => ({
  x: view === "cast" || view === "readability" ? proportionCameraValues.castCentre : proportionCameraValues.postCentre,
  z: view === "cast" || view === "readability" ? proportionCameraValues.castCentre : proportionCameraValues.postCentre,
  rotation: 0,
  // The readability rung projects an upright H to 40 CSS pixels.
  extent: view === "floor"
    ? proportionCameraValues.floorExtent
    : view === "post"
    ? proportionCameraValues.postExtent
    : view === "cast"
    ? proportionCameraValues.castExtent
    : figureHeight * Math.cos(cameraValues.pitchRadians) * height / studyCounts.readabilityHeightCssPx,
});

const poses: ReadonlyArray<FigurePose> = [
  "phone",
  "seated",
  "raised",
  "standing",
  "asleep",
  "phone",
  "throwing",
  "standing",
];
const jackets: ReadonlyArray<PaletteName> = ["jacket-blue-0", "jacket-red-0", "jacket-green-0"];
const ring = (outer: number, inner: number, height: number, y: number, slot: PaletteName): Part => {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return part(
    new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 32 }).rotateX(-Math.PI / 2)
      .translate(0, y, 0),
    slot,
  );
};
const cylinder = (r: number, h: number, x: number, y: number, z: number, slot: PaletteName) =>
  part(new THREE.CylinderGeometry(r, r, h, 32).translate(x, y, z), slot);

const installPost = (geometry: ProportionGeometry, centre: Point, index: number, night: boolean) => {
  const radius = roomyRecipe.counterRadiusRatio, top = roomyRecipe.worktopRatio;
  const depth = roomyRecipe.stationDepthRatio;
  const offset = (
    local: Point,
  ): Point => [
    centre[0] + local[0] * figureHeight,
    centre[1] + local[1] * figureHeight,
    centre[2] + local[2] * figureHeight,
  ];
  geometry.add(
    `post-${index}-counter`,
    [
      ring(radius - depth + .065, radius - depth, top - .045, 0, "timber-0"),
      ring(radius, radius - depth - .035, .045, top - .045, "timber-0"),
      ring(radius - .015, radius - .055, .09, top - .135, "timber-0"),
      cylinder(.06, roomyRecipe.monitorCrownRatio - .05, 0, (roomyRecipe.monitorCrownRatio - .05) / 2, 0, "steel-0"),
      cylinder(.36, .05, 0, roomyRecipe.monitorCrownRatio - .025, 0, "steel-0"),
    ],
    centre,
    0,
    figureHeight,
  );
  for (let station = 0; station < studyCounts.stationsPerPost; station++) {
    const angle = station * Math.PI / 4;
    const at = (
      r: number,
      side = 0,
    ): Point => [Math.sin(angle) * r + Math.cos(angle) * side, 0, Math.cos(angle) * r - Math.sin(angle) * side];
    const width = roomyRecipe.stationWidthRatio;
    const screen: PaletteName = night && station !== 0 && station !== 4 ? "screen-light-0" : "glass-0";
    const parts: Array<Part> = [
      box(.20, .035, .18, -.07, top + .0175, radius - depth * .53, "steel-0"),
      box(.34, .255, .16, -.07, top + .035 + .1275, radius - depth * .55, "steel-0"),
      box(.285, .205, .012, -.07, top + .035 + .1275, radius - depth * .55 + .086, screen),
      box(.22, .022, .10, -.06, top + .012, radius - .07, "steel-0"),
      box(.11, .07, .15, width * -.34, top + .035, radius - .11, "steel-0"),
    ];
    // Two radial frames bound the station's declared outer chord. Rectangular
    // slabs would overlap at their inner corners around a continuous counter.
    for (const side of [-1, 1]) {
      parts.push(part(
        new THREE.BoxGeometry(.035, top - .045, depth - .06)
          .translate(0, (top - .045) / 2, radius - depth / 2 - .015)
          .rotateY(side * Math.asin(width / (2 * radius))),
        "timber-0",
      ));
    }
    for (let paper = 0; paper < 3; paper++) {
      parts.push(
        part(
          new THREE.BoxGeometry(.14, .008, .18).rotateY(.06 + paper * .05).translate(
            width * .31,
            top + .004 + paper * .008,
            radius - .11,
          ),
          "paper-0",
        ),
      );
    }
    const lampX = width * -.36, lampZ = radius - depth * .78;
    parts.push(cylinder(.05, .018, lampX, top + .009, lampZ, "steel-0"));
    parts.push(box(.018, .26, .018, lampX, top + .14, lampZ, "steel-0"));
    parts.push(box(.018, .018, .12, lampX, top + .27, lampZ + .05, "steel-0"));
    parts.push(
      part(
        new THREE.SphereGeometry(.07, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, .65, 1).translate(
          lampX,
          top + .255,
          lampZ + .10,
        ),
        "steel-0",
      ),
    );
    parts.push(
      box(
        .115,
        .045,
        .012,
        lampX,
        top + .26,
        lampZ + .167,
        night && station !== 0 && station !== 4 ? "lamp-light-0" : "glass-0",
      ),
    );
    // The diagnostic has blank screens: no synthetic price is made to look
    // live, and provisional brass cannot distract from the proportion pick.
    geometry.add(`post-${index}-station-${station}`, parts, centre, angle, figureHeight);
    const crown = roomyRecipe.monitorCrownRatio - .22;
    geometry.add(
      `post-${index}-crown-${station}`,
      [
        box(.045, .045, .70, 0, crown + .10, .33, "steel-0"),
        box(.47, .34, .19, 0, crown, .62, "steel-0"),
        box(.395, .267, .012, 0, crown, .722, screen),
      ],
      centre,
      angle,
      figureHeight,
    );
    const jacket = jackets[(station + index) % jackets.length] ?? "jacket-blue-0";
    const pose = poses[station] ?? "standing";
    if (pose === "seated" || pose === "asleep") {
      geometry.add(
        `post-${index}-chair-${station}`,
        chairParts(top),
        offset(at(roomyRecipe.figureRadiusRatio)),
        angle + Math.PI,
        figureHeight,
      );
    }
    geometry.add(
      `post-${index}-figure-${station}-${pose}`,
      figureParts(roomyRecipe, pose, jacket, station % 3 === 0 ? 1.08 : .96),
      offset(at(roomyRecipe.figureRadiusRatio)),
      angle + Math.PI,
      figureHeight,
      true,
    );
  }
  for (let paper = 0; paper < 18; paper++) {
    const angle = paper * 2.399963229728653;
    const r = radius + .36 + (paper % 3) * .085;
    geometry.add(
      `post-${index}-floor-paper-${paper}`,
      [box(.14, .006, .18, 0, .003, 0, "paper-0")],
      offset([Math.sin(angle) * r, 0, Math.cos(angle) * r]),
      angle,
      figureHeight,
    );
  }
};

export const installProportionScene = (engine: Engine, view: ProportionView, night: boolean) =>
  Effect.try({
    try: () => {
      const builder = createProportionGeometry(engine, night);
      if (Option.isNone(builder)) return false;
      const geometry = builder.value;
      const data = engine.diagnosticScene();
      data.meshes.forEach(mesh => {
        mesh.visible = false;
      });
      data.scene.name = "synthetic-proportion-scene";
      const cast = view === "cast" || view === "readability";
      const pitch = roomyRecipe.postPitchRatio * figureHeight;
      // The loose-paper corners reach beyond 35 units, so a 68-unit tile is too small.
      const floorSize = cast
        ? studyLayout.castFloorWidth
        : view === "floor"
        ? studyLayout.floorWidth
        : studyLayout.postFloorWidth;
      geometry.add("timber-floor", [
        box(
          floorSize,
          studyLayout.floorThickness,
          cast ? studyLayout.castFloorDepth : floorSize,
          0,
          studyLayout.floorCentreY,
          0,
          "floor-0",
        ),
      ]);
      if (cast) {
        const castPoses: ReadonlyArray<FigurePose> = [
          "standing",
          "standing",
          "phone",
          "reading",
          "seated",
          "asleep",
          "walking",
          "throwing",
        ];
        castPoses.forEach((pose, index) => {
          const row = Math.floor(index / 4), column = index % 4;
          const centre: Point = [
            (column - 1.5) * studyLayout.castColumnPitch,
            0,
            (row - .5) * studyLayout.castRowPitch,
          ];
          if (pose === "seated" || pose === "asleep") {
            const top = roomyRecipe.worktopRatio;
            geometry.add(`cast-${index}-chair`, chairParts(top), centre, Math.PI / 4, figureHeight);
            geometry.add(
              `cast-${index}-worktop`,
              [
                box(.60, .035, .40, 0, top - .0175, .43, "timber-0"),
                box(.045, top - .035, .045, -.27, (top - .035) / 2, .26, "timber-0"),
                box(.045, top - .035, .045, .27, (top - .035) / 2, .26, "timber-0"),
                box(.045, top - .035, .045, -.27, (top - .035) / 2, .60, "timber-0"),
                box(.045, top - .035, .045, .27, (top - .035) / 2, .60, "timber-0"),
              ],
              centre,
              Math.PI / 4,
              figureHeight,
            );
          }
          geometry.add(
            `cast-${index}-${pose}`,
            figureParts(
              roomyRecipe,
              pose,
              jackets[index % jackets.length] ?? "jacket-blue-0",
              index % 2 === 0 ? 1.05 : .96,
            ),
            centre,
            index === 1 ? Math.PI * 1.25 : Math.PI / 4,
            figureHeight,
            true,
          );
        });
      } else if (view === "floor") {
        const centres: ReadonlyArray<Point> = [[-.5 * pitch, 0, .288675 * pitch], [.5 * pitch, 0, .288675 * pitch], [
          0,
          0,
          -.57735 * pitch,
        ]];
        centres.forEach((centre, index) => {
          installPost(geometry, centre, index, night);
          for (let visitor = 0; visitor < 2 + index * 2; visitor++) {
            const angle = Math.floor(visitor / 2) * 2.25 + .30 + (visitor % 2) * .28;
            const distance = roomyRecipe.counterRadiusRatio + .48;
            const origin: Point = [
              centre[0] + Math.sin(angle) * distance * figureHeight,
              0,
              centre[2] + Math.cos(angle) * distance * figureHeight,
            ];
            geometry.add(
              `post-${index}-spillover-${visitor}`,
              figureParts(
                roomyRecipe,
                visitor % 2 === 0 ? "walking" : "phone",
                jackets[(visitor + index) % jackets.length] ?? "jacket-blue-0",
              ),
              origin,
              angle + Math.PI * .75,
              figureHeight,
              true,
            );
          }
        });
      } else installPost(geometry, [0, 0, 0], 0, night);
      engine.setPalette(proportionPalette);
      engine.canvas.setAttribute("aria-label", "Synthetic proportion scene with posed figures");
      data.scene.updateMatrixWorld(true);
      return true;
    },
    catch: cause => new WorkbenchFailure({ operation: "proportion-scene", cause }),
  });
