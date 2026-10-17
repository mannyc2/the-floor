import { Effect, Option, Schema } from "effect";

// The slice of glTF 2.0 the trader kit reads: skinned meshes, their skeleton
// and keyframed animation. Images and materials are ignored; the trader is
// painted from the Atlas palette, not from the sources' textures.

const Index = Schema.Int;
const Accessor = Schema.Struct({
  bufferView: Schema.optional(Index),
  byteOffset: Schema.optional(Index),
  componentType: Schema.Literals([5120, 5121, 5122, 5123, 5125, 5126]),
  normalized: Schema.optional(Schema.Boolean),
  count: Index,
  type: Schema.Literals(["SCALAR", "VEC2", "VEC3", "VEC4", "MAT4"]),
});
const BufferView = Schema.Struct({
  buffer: Index,
  byteOffset: Schema.optional(Index),
  byteLength: Index,
  byteStride: Schema.optional(Index),
});
const Node = Schema.Struct({
  name: Schema.optional(Schema.String),
  children: Schema.optional(Schema.Array(Index)),
  translation: Schema.optional(Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])),
  rotation: Schema.optional(Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])),
  scale: Schema.optional(Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])),
  mesh: Schema.optional(Index),
  skin: Schema.optional(Index),
});
const Primitive = Schema.Struct({
  attributes: Schema.Record(Schema.String, Index),
  indices: Schema.optional(Index),
});
const Document = Schema.Struct({
  buffers: Schema.Array(Schema.Struct({ uri: Schema.optional(Schema.String), byteLength: Index })),
  bufferViews: Schema.Array(BufferView),
  accessors: Schema.Array(Accessor),
  nodes: Schema.Array(Node),
  meshes: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.optional(Schema.String), primitives: Schema.Array(Primitive) })),
  ),
  skins: Schema.optional(
    Schema.Array(Schema.Struct({ joints: Schema.Array(Index), inverseBindMatrices: Schema.optional(Index) })),
  ),
  animations: Schema.optional(Schema.Array(Schema.Struct({
    name: Schema.optional(Schema.String),
    channels: Schema.Array(Schema.Struct({
      sampler: Index,
      target: Schema.Struct({ node: Schema.optional(Index), path: Schema.String }),
    })),
    samplers: Schema.Array(Schema.Struct({
      input: Index,
      output: Index,
      interpolation: Schema.optional(Schema.Literals(["LINEAR", "STEP", "CUBICSPLINE"])),
    })),
  }))),
});
export type GltfDocument = typeof Document.Type;
export type GltfNode = typeof Document.Type["nodes"][number];

export class GltfError extends Schema.TaggedError<GltfError>()("GltfError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Gltf {
  readonly document: GltfDocument;
  readonly buffers: ReadonlyArray<Uint8Array>;
}

const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as const;
type Read = (view: DataView, at: number, normal: boolean) => number;
// Each component type's byte size and reader, normalized integers mapped to
// [0, 1] or [-1, 1] as glTF defines them.
const readers: Record<typeof Accessor.Type["componentType"], { readonly size: number; readonly read: Read }> = {
  5120: { size: 1, read: (view, at, normal) => Math.max(view.getInt8(at) / (normal ? 127 : 1), -1) },
  5121: { size: 1, read: (view, at, normal) => view.getUint8(at) / (normal ? 255 : 1) },
  5122: { size: 2, read: (view, at, normal) => Math.max(view.getInt16(at, true) / (normal ? 32767 : 1), -1) },
  5123: { size: 2, read: (view, at, normal) => view.getUint16(at, true) / (normal ? 65535 : 1) },
  5125: { size: 4, read: (view, at) => view.getUint32(at, true) },
  5126: { size: 4, read: (view, at) => view.getFloat32(at, true) },
};

// An accessor's bytes, if it has a view lying inside its buffer.
const dataOf = (document: GltfDocument, buffers: ReadonlyArray<Uint8Array>, accessor: typeof Accessor.Type) =>
  Option.fromUndefinedOr(accessor.bufferView).pipe(
    Option.flatMap(index => Option.fromUndefinedOr(document.bufferViews[index])),
    Option.flatMap(view =>
      Option.fromUndefinedOr(buffers[view.buffer]).pipe(
        Option.filter(buffer => (view.byteOffset ?? 0) + view.byteLength <= buffer.byteLength),
        Option.map(buffer => ({
          view,
          data: new DataView(buffer.buffer, buffer.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)),
        })),
      )
    ),
  );

// A `.glb`'s JSON chunk and binary chunk, or a `.gltf`'s JSON alone.
const chunks = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67) {
    return { json: bytes, binary: Option.none<Uint8Array>() };
  }
  const length = view.getUint32(12, true);
  return {
    json: bytes.subarray(20, 20 + length),
    binary: Option.some(bytes.subarray(28 + length, 28 + length + view.getUint32(20 + length, true))),
  };
};

// Reads a `.glb` container, or a `.gltf` whose buffers `external` resolves by URI.
export const readGltf = Effect.fnUntraced(function*(
  bytes: Uint8Array,
  external: (uri: string) => Effect.Effect<Uint8Array, GltfError>,
) {
  const { json, binary } = chunks(bytes);
  const document = yield* Schema.decodeEffect(Schema.fromJsonString(Document))(new TextDecoder().decode(json)).pipe(
    Effect.mapError(cause => new GltfError({ reason: "invalid document", cause })),
  );
  const buffers = yield* Effect.forEach(document.buffers, buffer =>
    Option.match(Option.fromUndefinedOr(buffer.uri), {
      onNone: () => Effect.mapError(Effect.fromOption(binary), () => new GltfError({ reason: "missing binary chunk" })),
      onSome: external,
    }));
  // Every accessor with a view must lie inside its buffer, so reads need no checks.
  const missing = document.accessors.findIndex(accessor =>
    Option.isSome(Option.fromUndefinedOr(accessor.bufferView)) && Option.isNone(dataOf(document, buffers, accessor))
  );
  if (missing >= 0) return yield* new GltfError({ reason: `accessor ${missing} has no data` });
  return { document, buffers } satisfies Gltf;
});

const fill = (out: Float32Array, accessor: typeof Accessor.Type, stride: number, data: DataView) => {
  const width = components[accessor.type];
  const { size, read } = readers[accessor.componentType];
  const normal = accessor.normalized === true;
  for (let element = 0; element < accessor.count; element++) {
    for (let component = 0; component < width; component++) {
      out[element * width + component] = read(data, element * stride + component * size, normal);
    }
  }
};

// An accessor's values as floats; zeros for one without a view.
export const readAccessor = (gltf: Gltf, index: number): Float32Array =>
  Option.match(Option.fromUndefinedOr(gltf.document.accessors[index]), {
    onNone: () => new Float32Array(),
    onSome: accessor => {
      const out = new Float32Array(accessor.count * components[accessor.type]);
      const size = readers[accessor.componentType].size * components[accessor.type];
      Option.map(dataOf(gltf.document, gltf.buffers, accessor), ({ view, data }) =>
        fill(out, accessor, view.byteStride ?? size, data));
      return out;
    },
  });
