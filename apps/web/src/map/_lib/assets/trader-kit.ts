import { Effect, Schema } from "effect";
import * as THREE from "three";

// The trader kit: the live floor's skinned trader and its baked motion, made
// at build time from CC0 human sources (see `assets/traders`) and fetched by
// the viewer as one binary. The build and the viewer share this format.

// Paints that resolve per trader in the shader. Each names what a region of
// the body shows in a jacket, or in shirtsleeves with rolled cuffs and braces.
export const traderPaints = {
  jacket: -2,
  trousers: -5,
  skin: -6,
  hair: -7,
  shirt: -8,
  tie: -9,
  // Torso and upper sleeves: the jacket, or the shirt.
  coat: -10,
  // Below the belt: the jacket's skirt, or the trousers.
  skirt: -11,
  // The tie's blade under a buttoned jacket: hidden, or the tie.
  tieLow: -12,
  // Forearms: the sleeve, or bare arms with the shirtsleeves rolled.
  forearm: -13,
  // Braces over the shirt: under the jacket, or the tie's colour.
  braces: -14,
  // Braces inside the jacket's opening: the shirt, or the braces.
  bracesOpen: -15,
  // The wrist: a shirt cuff under the sleeve, or bare skin.
  cuff: -16,
} as const;
export type TraderPaint = keyof typeof traderPaints;

export const hairStyles = ["parted", "buzzed", "long", "bun", "cropped"] as const;
export const bodies = ["male", "female"] as const;
export const outfits = ["jacket", "shirtsleeves"] as const;
// A vertex's visibility group: always shown, one hair style, or one body.
export const visibility = {
  always: 0,
  hair: (style: (typeof hairStyles)[number]) => 1 + hairStyles.indexOf(style),
  body: (body: (typeof bodies)[number]) => 8 + bodies.indexOf(body),
} as const;

// Props ride their own bones after the skeleton's joints, shown or hidden by
// a clip through their scale.
export const props = ["handset", "slip", "plane", "cup"] as const;

// A skin lane packs one joint and its weight as joint * 256 + weight * 255,
// exact in a float, so four influences fit one vertex attribute.
export const skinScale = 256;

const Header = Schema.Struct({
  bones: Schema.Array(Schema.String),
  frames: Schema.Int,
  clips: Schema.Array(Schema.Struct({ name: Schema.String, seconds: Schema.Finite })),
  vertices: Schema.Int,
  indices: Schema.Int,
  motion: Schema.Struct({ width: Schema.Int, height: Schema.Int }),
});
export type TraderKitHeader = typeof Header.Type;

export interface TraderKit {
  readonly header: TraderKitHeader;
  readonly position: Float32Array;
  readonly normal: Float32Array;
  // Surface, paint, line class and visibility group.
  readonly part: Float32Array;
  readonly skin: Float32Array;
  readonly index: Uint32Array;
  // Two texels per bone per frame: rotation, then translation and scale.
  // The file stores them as half floats, about 2 mm at a trader's scale.
  readonly motion: Float32Array;
}

export class TraderKitError extends Schema.TaggedError<TraderKitError>()("TraderKitError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const magic = 0x314b5446; // "FTK1"
const align = (n: number) => Math.ceil(n / 4) * 4;
const lengths = (header: TraderKitHeader) => ({
  position: header.vertices * 3,
  normal: header.vertices * 3,
  part: header.vertices * 4,
  skin: header.vertices * 4,
  index: header.indices,
  motion: header.motion.width * header.motion.height * 4,
});

export const encodeTraderKit = Effect.fnUntraced(function*(kit: TraderKit) {
  const json = new TextEncoder().encode(yield* Schema.encodeEffect(Schema.fromJsonString(Header))(kit.header));
  const sizes = lengths(kit.header);
  const start = align(8 + json.length);
  const total = start + 4 * (Object.values(sizes).reduce((sum, n) => sum + n, 0) - sizes.motion) + 2 * sizes.motion;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, json.length, true);
  bytes.set(json, 8);
  let at = start;
  const motion = Uint16Array.from(kit.motion, value => THREE.DataUtils.toHalfFloat(value));
  for (const array of [kit.position, kit.normal, kit.part, kit.skin, kit.index, motion]) {
    bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), at);
    at += array.byteLength;
  }
  return bytes;
});

// Where the build places the kit, beside the page.
export const traderKitFile = "trader-kit.bin";

export const decodeTraderKit = Effect.fnUntraced(function*(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || view.getUint32(0, true) !== magic) {
    return yield* new TraderKitError({ reason: "not a trader kit" });
  }
  const length = view.getUint32(4, true);
  const header = yield* Schema.decodeEffect(Schema.fromJsonString(Header))(
    new TextDecoder().decode(new Uint8Array(buffer, 8, length)),
  ).pipe(Effect.mapError(cause => new TraderKitError({ reason: "invalid header", cause })));
  const sizes = lengths(header);
  let at = align(8 + length);
  const take = (count: number, bytes = 4) => {
    const start = at;
    at += count * bytes;
    return start;
  };
  const position = take(sizes.position), normal = take(sizes.normal), part = take(sizes.part);
  const skin = take(sizes.skin), index = take(sizes.index), motion = take(sizes.motion, 2);
  if (at > buffer.byteLength) return yield* new TraderKitError({ reason: "truncated" });
  return {
    header,
    position: new Float32Array(buffer, position, sizes.position),
    normal: new Float32Array(buffer, normal, sizes.normal),
    part: new Float32Array(buffer, part, sizes.part),
    skin: new Float32Array(buffer, skin, sizes.skin),
    index: new Uint32Array(buffer, index, sizes.index),
    motion: Float32Array.from(
      new Uint16Array(buffer, motion, sizes.motion),
      value => THREE.DataUtils.fromHalfFloat(value),
    ),
  } satisfies TraderKit;
});
