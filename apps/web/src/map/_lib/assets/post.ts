import { figureHeight, roomyRecipe } from "@floor/atlas/proportions";
import * as THREE from "three";
import { annulus, box, cylinder, makeGeometry, socket } from "./geometry";

export interface PostOptions {
  // The world's stations and crown monitors per post. Eight of each is the
  // reviewed arrangement, and the asset review draws it.
  readonly stations?: number;
  readonly monitors?: number;
  // Segments around the counter rings; the live floor draws a hundred posts.
  readonly segments?: number;
}

// Origin at the floor below the post centre, +Y up; station placements face
// radially outward. Crown screens are blank: no reading is fabricated.
export const makePost = (options: PostOptions = {}): THREE.Group => {
  const stations = options.stations ?? 8, monitors = options.monitors ?? stations;
  const segments = options.segments ?? 96;
  const round = (count: number) => Math.max(12, Math.round(count * segments / 96));
  const root = new THREE.Group();
  root.name = "trading_post";
  const radius = roomyRecipe.counterRadiusRatio * figureHeight;
  const depth = roomyRecipe.stationDepthRatio * figureHeight;
  const width = roomyRecipe.stationWidthRatio * figureHeight;
  const top = roomyRecipe.worktopRatio * figureHeight;
  const crown = roomyRecipe.monitorCrownRatio * figureHeight;
  const kit = makeGeometry();
  kit.add(annulus(radius - depth + .52, radius - depth, top - .36, 0, segments), "timber-0");
  kit.add(annulus(radius, radius - depth - .28, .36, top - .36, segments), "timber-0");
  kit.add(annulus(radius - .12, radius - .44, .70, top - 1.06, segments), "timber-0");
  kit.add(annulus(radius - depth + .08, radius - depth - .20, .40, top - .76, segments), "timber-0");
  kit.add(cylinder(.46, crown - 1.20, [0, (crown - 1.20) / 2, 0], round(32)), "steel-0");
  kit.add(cylinder(.79, .24, [0, .12, 0], round(32)), "steel-0");
  kit.add(cylinder(2.88, .36, [0, crown - .18, 0], round(48)), "steel-0");
  kit.add(annulus(2.96, 2.68, .15, crown - 2.55, round(48)), "steel-0");
  // Radial frames bound each station's declared chord. Where a fuller ring's
  // chords would cross, neighbours share one frame between them.
  const frameYaw = Math.asin(width / (2 * radius));
  const shared = frameYaw >= Math.PI / stations;
  const frame = (yaw: number) =>
    kit.add(box(.28, top - .36, depth - .48, [0, (top - .36) / 2, radius - depth / 2 - .12]).rotateY(yaw), "timber-0");
  // One pass keeps the reviewed eight-station post's authored part order.
  for (let index = 0; index < Math.max(stations, monitors); index++) {
    const yaw = index * Math.PI * 2 / stations;
    if (index < stations) {
      if (shared) frame(yaw + Math.PI / stations);
      else for (const side of [-1, 1]) frame(yaw + side * frameYaw);
    }
    if (index < monitors) {
      const crownYaw = index * Math.PI * 2 / monitors;
      const orient = (geometry: THREE.BufferGeometry) => geometry.rotateY(crownYaw);
      kit.add(orient(box(.30, .30, 4.96, [0, crown - 1.65, 2.48])), "steel-0");
      kit.add(orient(box(3.76, 2.72, 1.20, [0, crown - 1.36, 4.96])), "steel-0");
      kit.add(orient(box(3.16, 2.14, .04, [0, crown - 1.36, 5.58])), "glass-0", 1);
    }
    if (index < stations) {
      const station = new THREE.Object3D();
      station.name = `station_${String(index).padStart(2, "0")}`;
      station.position.set(Math.sin(yaw) * radius, 0, Math.cos(yaw) * radius);
      station.rotation.y = yaw;
      station.userData = {
        placement: { kind: "station", accepts: ["desk/operator", "desk/analyst"], maximumSize: [width, 8, depth + .5] },
      };
      root.add(station);
    }
    if (index < monitors) {
      const crownYaw = index * Math.PI * 2 / monitors;
      socket(
        root,
        `crown_instrument_${index}`,
        "instrument",
        [Math.sin(crownYaw) * 5.62, crown - 1.36, Math.cos(crownYaw) * 5.62],
        [3, 2, .08],
        ["screen_reading"],
        crownYaw,
      );
      socket(
        root,
        `crown_logo_${index}`,
        "logo",
        [Math.sin(crownYaw) * 5.63, crown - 1.36, Math.cos(crownYaw) * 5.63],
        [1.10, 1.10, .02],
        ["token_logo"],
        crownYaw,
      );
    }
  }
  root.add(kit.finish("trading_post_body"));
  root.updateMatrixWorld(true);
  return root;
};
