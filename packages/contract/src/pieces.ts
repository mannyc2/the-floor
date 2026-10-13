import { Option, Schema } from "effect";
import { Author } from "./agents.ts";
import { AssetRef, Checkpoint, Digest, Label, OwnerId, PieceId, Timestamp, VersionId } from "./identifiers.ts";
import { Plot } from "./world.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
export const ReadingKind = Schema.Literals([
  "price",
  "change5m",
  "change1h",
  "buys5m",
  "sells5m",
  "volume1h",
  "holders",
  "curve",
  "marketCap",
  "lastTradeSeconds",
]);
export const TokenEvent = Schema.Literals([
  "newHigh",
  "largeBuy",
  "largeSell",
  "holderMilestone",
  "graduated",
  "revived",
]);
export const Reading = Schema.TaggedUnion({
  price: { value: Nonnegative },
  change5m: { value: Schema.Finite },
  change1h: { value: Schema.Finite },
  buys5m: { value: Count },
  sells5m: { value: Count },
  volume1h: { value: Nonnegative },
  holders: { value: Count },
  curve: { value: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })) },
  marketCap: { value: Nonnegative },
  lastTradeSeconds: { value: Nonnegative },
});
export const ReadingOrigin = Schema.TaggedUnion({
  Chain: { reference: Label },
  Provider: { provider: Label, reference: Label },
});
export const ReadingSource = Schema.Union([
  ReadingOrigin,
  Schema.TaggedStruct("Replay", { recording: Label, original: ReadingOrigin }),
]);
// Absence is a separate outcome, so an unavailable reading cannot masquerade as
// a measured zero. Synthetic bench sources never enter the live contract.
export const Binding = Schema.Struct({
  token: AssetRef,
  source: ReadingSource,
  checkpoint: Checkpoint,
  observation: Schema.TaggedUnion({
    Available: { reading: Reading },
    Unavailable: { kind: ReadingKind, reason: Label },
  }),
}).check(
  Schema.makeFilter((binding) =>
    binding.token.startsWith(`${binding.checkpoint.chain}/`)
    || "The reading and checkpoint must belong to the same chain"
  ),
);
export type Binding = typeof Binding.Type;
export const BindingDeclaration = Schema.Struct({ name: Label, token: AssetRef, reading: ReadingKind });

const NodeIndex = Count;
// A topologically ordered expression graph is bounded data: it cannot encode
// loops, a function call, mutable state, or an undeclared source of input.
export const DriverNode = Schema.TaggedUnion({
  Constant: { value: Schema.Finite },
  Time: {},
  Reading: { binding: Label },
  Unary: { operation: Schema.Literals(["sin", "ease", "abs"]), input: NodeIndex },
  Binary: {
    operation: Schema.Literals(["add", "subtract", "multiply", "divide", "min", "max", "step"]),
    left: NodeIndex,
    right: NodeIndex,
  },
  Clamp: { input: NodeIndex, minimum: NodeIndex, maximum: NodeIndex },
});
export const Driver = Schema.Struct({
  nodes: Schema.Array(DriverNode).check(Schema.isBetweenLength(1, 128)),
  output: NodeIndex,
}).check(Schema.makeFilter((driver) => {
  if (driver.output >= driver.nodes.length) return "Driver output must name an expression node";
  return driver.nodes.every((node, index) =>
    DriverNode.match(node, {
      Constant: () => true,
      Time: () => true,
      Reading: () => true,
      Unary: (value) => value.input < index,
      Binary: (value) => value.left < index && value.right < index,
      Clamp: (value) => value.input < index && value.minimum < index && value.maximum < index,
    })
  ) || "Expression inputs must precede their node";
}));
const Vector = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);
export const Geometry = Schema.Struct({
  vertices: Schema.Array(Vector).check(Schema.isMaxLength(65536)),
  triangles: Schema.Array(Schema.Tuple([NodeIndex, NodeIndex, NodeIndex])).check(Schema.isMaxLength(65536)),
}).check(
  Schema.makeFilter((geometry) =>
    geometry.triangles.every((triangle) => triangle.every((index) => index < geometry.vertices.length))
    || "Triangle indices must refer to this geometry's vertices"
  ),
);
export const Socket = Schema.Struct({
  name: Label,
  position: Vector,
  permission: Schema.TaggedUnion({ Public: {}, AuthorOnly: {}, Owners: { owners: Schema.NonEmptyArray(OwnerId) } }),
});
export const ReadingScale = Schema.TaggedUnion({
  DayRange: {},
  Fixed: { minimum: Schema.Finite, maximum: Schema.Finite },
}).check(
  Schema.makeFilter((scale) =>
    scale._tag !== "Fixed" || scale.minimum < scale.maximum || "An engraved scale must have a positive range"
  ),
);
export const SocketAttachment = Schema.TaggedUnion({
  LocalSocket: { name: Label },
  ExternalSocket: { piece: PieceId, version: VersionId, name: Label },
});
const partFields = {
  id: Label,
  geometry: Geometry,
  surface: Label,
  socket: Schema.OptionFromNullOr(SocketAttachment),
  motion: Schema.OptionFromNullOr(Driver),
};
export const PiecePart = Schema.Union([
  Schema.TaggedStruct("Decoration", {
    ...partFields,
    material: Label.check(
      Schema.makeFilter((slot) => slot.toLowerCase() !== "brass" || "Brass is reserved for live readings"),
    ),
  }),
  Schema.TaggedStruct("Instrument", {
    ...partFields,
    material: Schema.Literal("brass"),
    binding: Label,
    scale: ReadingScale,
  }),
]);
export const Behaviour = Schema.Struct({
  states: Schema.NonEmptyArray(Label).check(Schema.isUnique()),
  initial: Label,
  transitions: Schema.Array(Schema.Struct({ from: Label, event: TokenEvent, to: Label })),
}).check(Schema.makeFilter((behaviour) => {
  if (!behaviour.states.includes(behaviour.initial)) return "The initial state must be declared";
  const transitions = behaviour.transitions;
  return transitions.every((transition, index) =>
    behaviour.states.includes(transition.from) && behaviour.states.includes(transition.to)
    && !transitions.slice(0, index).some((earlier) =>
      earlier.from === transition.from && earlier.event === transition.event
    )
  ) || "Transitions must use declared states and have at most one destination per state and event";
}));
export const PieceBudget = Schema.Struct({
  triangles: Count,
  parts: Count,
  animatedNodes: Count,
  texturePixels: Count,
});
const checkPart = (part: typeof PiecePart.Type, names: ReadonlyArray<string>, sockets: ReadonlyArray<string>) => {
  if (
    Option.isSome(part.socket) && part.socket.value._tag === "LocalSocket" && !sockets.includes(part.socket.value.name)
  ) {
    return "A part must attach to a declared socket";
  }
  if (part._tag === "Instrument" && !names.includes(part.binding)) return "An instrument must name a declared binding";
  return Option.isNone(part.motion)
    || part.motion.value.nodes.every((node) =>
      node._tag !== "Reading" || (part._tag === "Instrument" && names.includes(node.binding))
    ) || "Only brass instruments may be driven by declared live readings";
};

export const Piece = Schema.Struct({
  id: PieceId,
  author: Author,
  version: VersionId,
  createdAt: Timestamp,
  plot: Plot,
  name: Label,
  bindings: Schema.Array(BindingDeclaration),
  sockets: Schema.Array(Socket),
  output: Schema.Struct({
    parts: Schema.Array(PiecePart),
    behaviours: Schema.Array(Behaviour),
    textures: Schema.Array(Schema.Struct({ id: Label, contentDigest: Digest, width: Count, height: Count })),
  }),
  budget: PieceBudget,
}).check(Schema.makeFilter((piece) => {
  const names = piece.bindings.map((binding) => binding.name);
  if (new Set(names).size !== names.length) return "Binding names must be unique";
  if (piece.bindings.some((binding) => Option.isNone(piece.plot.token) || binding.token !== piece.plot.token.value)) {
    return "A piece may bind only its plot's token";
  }
  if (Option.isNone(piece.plot.token) && piece.output.behaviours.length > 0) {
    return "A tokenless piece has no token events";
  }
  const sockets = piece.sockets.map((socket) => socket.name);
  if (new Set(sockets).size !== sockets.length) return "Socket names must be unique";
  const parts = piece.output.parts;
  if (new Set(parts.map((part) => part.id)).size !== parts.length) return "Part ids must be unique";
  const textures = piece.output.textures;
  if (new Set(textures.map((texture) => texture.id)).size !== textures.length) return "Texture ids must be unique";
  for (const part of parts) {
    const issue = checkPart(part, names, sockets);
    if (issue !== true) return issue;
  }
  return piece.budget.parts === parts.length
      && piece.budget.triangles === parts.reduce((sum, part) => sum + part.geometry.triangles.length, 0)
      && piece.budget.animatedNodes === parts.filter((part) => Option.isSome(part.motion)).length
      && piece.budget.texturePixels === textures.reduce((sum, texture) => sum + texture.width * texture.height, 0)
    || "Budget figures must match the built output";
}));
export type Piece = typeof Piece.Type;
