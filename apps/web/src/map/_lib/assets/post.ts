import { figureHeight, roomyRecipe } from "@floor/atlas/proportions";
import * as THREE from "three";
import { annulus, box, cylinder, makeGeometry, socket } from "./geometry";

// Eight stations is a review arrangement; post capacity is still open.
const postStationCount = 8;

// Origin at the floor below the post centre, +Y up; station placements face
// radially outward. Crown screens are blank: no reading is fabricated.
export const makePost = (): THREE.Group => {
  const root = new THREE.Group();
  root.name = "trading_post";
  const radius = roomyRecipe.counterRadiusRatio * figureHeight;
  const depth = roomyRecipe.stationDepthRatio * figureHeight;
  const width = roomyRecipe.stationWidthRatio * figureHeight;
  const top = roomyRecipe.worktopRatio * figureHeight;
  const crown = roomyRecipe.monitorCrownRatio * figureHeight;
  const kit = makeGeometry();
  kit.add(annulus(radius - depth + .52, radius - depth, top - .36, 0), "timber-0");
  kit.add(annulus(radius, radius - depth - .28, .36, top - .36), "timber-0");
  kit.add(annulus(radius - .12, radius - .44, .70, top - 1.06), "timber-0");
  kit.add(annulus(radius - depth + .08, radius - depth - .20, .40, top - .76), "timber-0");
  kit.add(cylinder(.46, crown - 1.20, [0, (crown - 1.20) / 2, 0], 32), "steel-0");
  kit.add(cylinder(.79, .24, [0, .12, 0], 32), "steel-0");
  kit.add(cylinder(2.88, .36, [0, crown - .18, 0], 48), "steel-0");
  kit.add(annulus(2.96, 2.68, .15, crown - 2.55, 48), "steel-0");
  const frameYaw = Math.asin(width / (2 * radius));
  for (let index = 0; index < postStationCount; index++) {
    const yaw = index * Math.PI * 2 / postStationCount;
    for (const side of [-1, 1]) {
      kit.add(
        box(.28, top - .36, depth - .48, [0, (top - .36) / 2, radius - depth / 2 - .12])
          .rotateY(yaw + side * frameYaw),
        "timber-0",
      );
    }
    const orient = (geometry: THREE.BufferGeometry) => geometry.rotateY(yaw);
    kit.add(orient(box(.30, .30, 4.96, [0, crown - 1.65, 2.48])), "steel-0");
    kit.add(orient(box(3.76, 2.72, 1.20, [0, crown - 1.36, 4.96])), "steel-0");
    kit.add(orient(box(3.16, 2.14, .04, [0, crown - 1.36, 5.58])), "glass-0", 1);
    const station = new THREE.Object3D();
    station.name = `station_${String(index).padStart(2, "0")}`;
    station.position.set(Math.sin(yaw) * radius, 0, Math.cos(yaw) * radius);
    station.rotation.y = yaw;
    station.userData = {
      placement: { kind: "station", accepts: ["desk/operator", "desk/analyst"], maximumSize: [width, 8, depth + .5] },
    };
    root.add(station);
    socket(
      root,
      `crown_instrument_${index}`,
      "instrument",
      [Math.sin(yaw) * 5.62, crown - 1.36, Math.cos(yaw) * 5.62],
      [3, 2, .08],
      ["screen_reading"],
      yaw,
    );
    socket(
      root,
      `crown_logo_${index}`,
      "logo",
      [Math.sin(yaw) * 5.63, crown - 1.36, Math.cos(yaw) * 5.63],
      [1.10, 1.10, .02],
      ["token_logo"],
      yaw,
    );
  }
  root.add(kit.finish("trading_post_body"));
  root.updateMatrixWorld(true);
  return root;
};
