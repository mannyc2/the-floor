import { figureHeight, roomyRecipe } from "@floor/atlas/proportions";
import * as THREE from "three";
import { box, cylinder, type GeometryBuilder, makeGeometry, type Point, socket } from "./geometry";

export const stationVariants: ReadonlyArray<"operator" | "analyst"> = ["operator", "analyst"];
type StationVariant = (typeof stationVariants)[number];

const stationLayout = {
  operator: {
    screenX: -.55,
    screenZ: -1.99,
    screenYaw: .04,
    phoneX: -2.42,
    phoneZ: -.60,
    phoneYaw: .15,
    lampX: -2.60,
    lampReach: .94,
    tapeX: 2.55,
    tapeZ: -2.36,
    paperX: 1.43,
    paperZ: -.65,
    paperCount: 3,
    paperYaw: .06,
    flagX: 3.02,
    flagCentre: 2.60,
    pieceX: 1.45,
    pieceZ: -1.80,
  },
  analyst: {
    screenX: -.72,
    screenZ: -2.05,
    screenYaw: -.07,
    phoneX: -2.75,
    phoneZ: -.79,
    phoneYaw: -.14,
    lampX: 2.45,
    lampReach: .77,
    tapeX: -2.72,
    tapeZ: -2.48,
    paperX: 1.19,
    paperZ: -.57,
    paperCount: 5,
    paperYaw: -.09,
    flagX: -3.03,
    flagCentre: -2.61,
    pieceX: 2.65,
    pieceZ: -1.15,
  },
};

const phone = (kit: GeometryBuilder, x: number, y: number, z: number, yaw: number) => {
  const orient = (geometry: THREE.BufferGeometry) => geometry.rotateY(yaw).translate(x, y, z);
  kit.add(orient(box(.88, .31, 1.05, [0, .155, 0])), "steel-0");
  kit.add(orient(box(.48, .018, .40, [0, .32, .20])), "glass-0");
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      kit.add(
        orient(box(.085, .022, .065, [(column - 1) * .14, .342, .08 + row * .105])),
        "steel-0",
      );
    }
  }
  const receiver = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.40, .40, -.24),
    new THREE.Vector3(-.29, .53, -.31),
    new THREE.Vector3(.29, .53, -.31),
    new THREE.Vector3(.40, .40, -.24),
  ]);
  kit.add(orient(new THREE.TubeGeometry(receiver, 12, .085, 8, false)), "steel-0");
  for (const end of [-1, 1]) {
    kit.add(
      orient(new THREE.SphereGeometry(.16, 12, 6).scale(1, .6, 1.1).translate(end * .40, .39, -.24)),
      "steel-0",
    );
  }
};

const lamp = (kit: GeometryBuilder, x: number, y: number, z: number, reach: number) => {
  kit.add(cylinder(.34, .10, [x, y + .05, z]), "steel-0");
  kit.add(cylinder(.07, 1.65, [x, y + .89, z], 16), "steel-0");
  kit.add(new THREE.SphereGeometry(.13, 12, 6).translate(x, y + 1.69, z), "steel-0");
  kit.add(box(.13, .13, reach, [x, y + 1.70, z + reach / 2]), "steel-0");
  kit.add(
    new THREE.SphereGeometry(.49, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1, .52, .66).translate(x, y + 1.58, z + reach),
    "steel-0",
  );
  // The visible aperture is flat, including at night: it emits no light pool.
  kit.add(box(.75, .14, .035, [x, y + 1.63, z + reach + .28]), "glass-0", 2);
};

const tape = (kit: GeometryBuilder, x: number, y: number, z: number, longer: boolean) => {
  kit.add(box(.82, .45, .66, [x, y + .225, z]), "steel-0");
  kit.add(box(.54, .055, .03, [x, y + .34, z + .345]), "glass-0");
  kit.add(box(.46, .025, .43, [x, y + .30, z + .54]), "paper-0");
  kit.add(box(.46, .28, .025, [x, y + .16, z + .74]), "paper-0");
  kit.add(box(.46, .022, longer ? .78 : .41, [x, y + .017, z + (longer ? 1.12 : .94)]), "paper-0");
};

// The live floor draws about ten pixels to a kit unit, where keys, cords, the
// tape slit and the flag pole only scribble and a fanned paper stack's offset
// sheets read as hatching. Its station keeps the screen, keyboard, phone, lamp,
// papers and nameplate as plain solids and leaves out the tape and the flag,
// which also keeps a ten-station ring's neighbours apart.
export type StationDetail = "review" | "live";

const livePhone = (kit: GeometryBuilder, x: number, y: number, z: number, yaw: number) => {
  const orient = (geometry: THREE.BufferGeometry) => geometry.rotateY(yaw).translate(x, y, z);
  kit.add(orient(box(.88, .31, 1.05, [0, .155, 0])), "steel-0");
  kit.add(orient(box(.96, .16, .34, [0, .40, -.24])), "steel-0");
};
const liveLamp = (kit: GeometryBuilder, x: number, y: number, z: number, reach: number) => {
  kit.add(cylinder(.34, .10, [x, y + .05, z], 12), "steel-0");
  kit.add(box(.14, 1.65, .14, [x, y + .89, z]), "steel-0");
  kit.add(box(.13, .13, reach, [x, y + 1.70, z + reach / 2]), "steel-0");
  kit.add(
    new THREE.SphereGeometry(.49, 10, 3, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1, .52, .66).translate(x, y + 1.58, z + reach),
    "steel-0",
  );
  kit.add(box(.75, .14, .035, [x, y + 1.63, z + reach + .28]), "glass-0", 2);
};

// Origin at the floor below the outer counter lip; +Z faces the trader. It
// attaches at a post's station placement. Screens and tape are blank.
export const makeStation = (variant: StationVariant, detail: StationDetail = "review"): THREE.Group => {
  const root = new THREE.Group();
  root.name = variant;
  const top = roomyRecipe.worktopRatio * figureHeight;
  const kit = makeGeometry();
  const analyst = variant === "analyst";
  const live = detail === "live";
  const layout = stationLayout[variant];
  const { screenX, screenZ, screenYaw } = layout;
  const orientScreen = (geometry: THREE.BufferGeometry) => geometry.rotateY(screenYaw).translate(screenX, top, screenZ);
  kit.add(orientScreen(box(1.48, .13, 1.02, [0, .065, .06])), "steel-0");
  kit.add(orientScreen(box(.26, .44, .26, [0, .33, -.15])), "steel-0");
  kit.add(orientScreen(box(2.76, 2.08, .86, [0, 1.37, -.10])), "steel-0");
  kit.add(orientScreen(box(2.34, 1.65, .035, [0, 1.39, .348])), "glass-0", 1);
  kit.add(box(1.70, .12, .65, [screenX, top + .06, -.52]), "steel-0");
  if (live) {
    livePhone(kit, layout.phoneX, top, layout.phoneZ, layout.phoneYaw);
    liveLamp(kit, layout.lampX, top, -2.65, layout.lampReach);
    kit.add(
      new THREE.BoxGeometry(1.04, .025 + .028 * (layout.paperCount - 1), 1.30).rotateY(layout.paperYaw)
        .translate(layout.paperX, top + .01 + .014 * layout.paperCount, layout.paperZ),
      "paper-0",
    );
  } else {
    kit.add(box(1.44, .025, .43, [screenX, top + .1325, -.52]), "glass-0");
    for (let row = 0; row < 3; row++) {
      kit.add(box(1.30, .022, .035, [screenX, top + .156, -.66 + row * .14]), "steel-0");
    }
    phone(kit, layout.phoneX, top, layout.phoneZ, layout.phoneYaw);
    lamp(kit, layout.lampX, top, -2.65, layout.lampReach);
    tape(kit, layout.tapeX, top, layout.tapeZ, analyst);
    for (let index = 0; index < layout.paperCount; index++) {
      kit.add(
        new THREE.BoxGeometry(1.04, .025, 1.30).rotateY((index - 1) * .055 + layout.paperYaw)
          .translate(layout.paperX + index * .035, top + .022 + index * .028, layout.paperZ),
        "paper-0",
      );
    }
  }
  if (analyst) {
    kit.add(box(1.35, .08, 1.48, [1.34, top + .04, -2.15]), "steel-0");
    kit.add(box(1.14, .11, 1.28, [1.34, top + .13, -2.15]), "paper-0");
  }
  kit.add(box(1.20, .34, .15, [1.20, top + .17, .055]), "steel-0");
  kit.add(box(1.06, .25, .025, [1.20, top + .18, .145]), "paper-0");
  if (!live) {
    const { flagX, flagCentre } = layout;
    kit.add(cylinder(.15, .08, [flagX, top + .04, -2.94], 16), "steel-0");
    kit.add(cylinder(.034, 2.34, [flagX, top + 1.21, -2.94], 12), "steel-0");
    kit.add(box(.84, .56, .025, [flagCentre, top + 2.08, -2.94]), "glass-0");
    kit.add(box(.84, .15, .035, [flagCentre, top + 2.08, -2.94]), "steel-0");
  }
  root.add(kit.finish(`${variant}_body`));
  const screenSocketAt = (front: number): Point => [
    screenX + Math.sin(screenYaw) * front,
    top + 1.39,
    screenZ + Math.cos(screenYaw) * front,
  ];
  socket(root, "instrument_screen", "instrument", screenSocketAt(.38), [2.20, 1.50, .08], [
    "screen_reading",
  ], screenYaw);
  socket(root, "logo_screen", "logo", screenSocketAt(.39), [.72, .72, .02], ["token_logo"], screenYaw);
  socket(root, "nameplate_label", "nameplate", [1.20, top + .18, .166], [1, .20, .015], ["agent_nameplate"]);
  socket(root, "desk_piece", "piece", [layout.pieceX, top, layout.pieceZ], [1.10, 1.30, .85], [
    "desk_piece",
  ]);
  socket(
    root,
    "figure",
    "figure",
    [0, 0, (roomyRecipe.figureRadiusRatio - roomyRecipe.counterRadiusRatio) * figureHeight],
    [3.2, 8, 3.2],
    ["figure"],
    Math.PI,
  );
  root.updateMatrixWorld(true);
  return root;
};
