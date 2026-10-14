// oxlint-disable effect/preferTaggedConstructors -- These boundary properties deliberately build malformed tagged records; constructors would reject them before the Schema under test can inspect them.
import { expect, test } from "bun:test";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { AssetRef } from "../src/identifiers.ts";
import {
  Behaviour,
  Binding,
  BindingDeclaration,
  Driver,
  DriverNode,
  Geometry,
  Piece,
  PieceBudget,
  PieceMaterial,
  PiecePart,
  Reading,
  ReadingKind,
  ReadingOrigin,
  ReadingScale,
  ReadingSource,
  Socket,
  SocketAttachment,
  TokenEvent,
} from "../src/pieces.ts";
import { expectPassed, roundTrip, runTest } from "./_runtime.ts";

const options = { seed: "stage-1-pieces", runs: 100, size: 8 };

const checkSchema = <A, I>(name: string, schema: Schema.Codec<A, I>) =>
  test(`${name} round trips schema-derived values`, () =>
    runTest(
      Arbitrary.checkEffect(Arbitrary.schema(schema), (value) => roundTrip(schema, value), options).pipe(
        Effect.tap(expectPassed),
      ),
    ));
checkSchema("ReadingKind", ReadingKind);
checkSchema("TokenEvent", TokenEvent);
checkSchema("Reading", Reading);
checkSchema("ReadingOrigin", ReadingOrigin);
checkSchema("ReadingSource", ReadingSource);
checkSchema("BindingDeclaration", BindingDeclaration);
checkSchema("DriverNode", DriverNode);
checkSchema("Socket", Socket);
checkSchema("SocketAttachment", SocketAttachment);
checkSchema("PieceBudget", PieceBudget);
checkSchema("PieceMaterial", PieceMaterial);

test("reading scales round trip and require a real range", () =>
  runTest(
    Arbitrary.checkEffect(Arbitrary.schema(ReadingScale), (value) => roundTrip(ReadingScale, value), options).pipe(
      Effect.tap(expectPassed),
      Effect.map(() => expect(Schema.is(ReadingScale)({ _tag: "Fixed", minimum: 2, maximum: 2 })).toBe(false)),
    ),
  ));

const bindingArbitrary = Arbitrary.schema(Schema.Struct(Binding.fields)).pipe(Arbitrary.map((binding) => {
  const suffix = binding.token.slice(binding.token.indexOf("/") + 1);
  return Binding.make({ ...binding, token: AssetRef.make(`${binding.checkpoint.chain}/${suffix}`) });
}));
test("bindings round trip available, unavailable and labelled replay readings", () =>
  runTest(
    Arbitrary.checkEffect(bindingArbitrary, (binding) => roundTrip(Binding, binding), options).pipe(
      Effect.tap(expectPassed),
    ),
  ));
test("bindings reject another chain and invented synthetic sources", () =>
  runTest(
    Arbitrary.checkEffect(bindingArbitrary, (binding) =>
      !Schema.is(Binding)({ ...binding, token: AssetRef.make("other:chain/token:value") })
      && !Schema.is(Binding)({ ...binding, source: { _tag: "Synthetic" } }), options).pipe(Effect.tap(expectPassed)),
  ));
test("unavailable readings cannot carry a fabricated value", () =>
  runTest(
    Effect.gen(function*() {
      const observation = Binding.fields.observation;
      const missing = yield* Schema.decodeEffect(observation)({
        _tag: "Unavailable",
        kind: "holders",
        reason: "provider offline",
      });
      expect(missing._tag).toBe("Unavailable");
      expect(Schema.is(Reading)({ _tag: "holders", value: -1 })).toBe(false);
      expect(Schema.is(Reading)({ _tag: "curve", value: 1.01 })).toBe(false);
      expect(Schema.is(Reading)({ _tag: "price", value: Number.NaN })).toBe(false);
      expect(Schema.is(Reading)({ _tag: "price", value: Number.POSITIVE_INFINITY })).toBe(false);
    }),
  ));

const driverArbitrary = Arbitrary.schema(Schema.Tuple([Schema.Finite, BindingDeclaration])).pipe(
  Arbitrary.map(([value, declaration]) =>
    Driver.make({
      nodes: [
        { _tag: "Constant", value },
        { _tag: "Time" },
        { _tag: "Reading", binding: declaration.name },
        { _tag: "Unary", operation: "sin", input: 1 },
        { _tag: "Binary", operation: "multiply", left: 0, right: 3 },
        { _tag: "Clamp", input: 4, minimum: 0, maximum: 2 },
      ],
      output: 5,
    })
  ),
);
test("drivers round trip acyclic expressions and reject loops or unknown output", () =>
  runTest(
    Arbitrary.checkEffect(driverArbitrary, (driver) =>
      roundTrip(Driver, driver).pipe(Effect.map((equal) =>
        equal && !Schema.is(Driver)({ ...driver, output: driver.nodes.length })
        && !Schema.is(Driver)({ nodes: [{ _tag: "Unary", operation: "sin", input: 0 }], output: 0 })
      )), options).pipe(Effect.tap(expectPassed)),
  ));
const geometryArbitrary = Arbitrary.schema(
  Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])).check(Schema.isBetweenLength(3, 8)),
).pipe(
  Arbitrary.map((vertices) => Geometry.make({ vertices, triangles: [[0, 1, 2]] })),
);
test("geometry round trips and rejects indices outside its own vertices", () =>
  runTest(
    Arbitrary.checkEffect(geometryArbitrary, (geometry) =>
      roundTrip(Geometry, geometry).pipe(Effect.map((equal) =>
        equal && !Schema.is(Geometry)({ ...geometry, triangles: [[0, 1, geometry.vertices.length]] })
      )), options).pipe(Effect.tap(expectPassed)),
  ));
const behaviourArbitrary = Arbitrary.schema(TokenEvent).pipe(Arbitrary.map((event) =>
  Behaviour.make({
    states: ["idle", "active"],
    initial: "idle",
    transitions: [{ from: "idle", event, to: "active" }],
  })
));
test("behaviours round trip deterministic transitions and reject ambiguity", () =>
  runTest(
    Arbitrary.checkEffect(behaviourArbitrary, (behaviour) =>
      roundTrip(Behaviour, behaviour).pipe(Effect.map((equal) =>
        equal && !Schema.is(Behaviour)({ ...behaviour, initial: "unknown" })
        && !Schema.is(Behaviour)({ ...behaviour, transitions: [...behaviour.transitions, ...behaviour.transitions] })
      )), options).pipe(Effect.tap(expectPassed)),
  ));

const pieceSeed = Schema.Struct({
  id: Piece.fields.id,
  author: Piece.fields.author,
  version: Piece.fields.version,
  createdAt: Piece.fields.createdAt,
  plot: Piece.fields.plot,
  name: Piece.fields.name,
  declaration: BindingDeclaration,
  vertex: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]),
});
const pieceArbitrary = Arbitrary.schema(pieceSeed).pipe(Arbitrary.map((seed) =>
  Piece.make({
    id: seed.id,
    author: seed.author,
    version: seed.version,
    createdAt: seed.createdAt,
    plot: { ...seed.plot, token: Option.some(seed.declaration.token) },
    name: seed.name,
    bindings: [seed.declaration],
    sockets: [],
    output: {
      parts: [
        {
          _tag: "Instrument",
          id: "gauge",
          material: { _tag: "Brass", slot: "gauge" },
          surface: "gauge-face",
          socket: Option.none(),
          geometry: { vertices: [seed.vertex, seed.vertex, seed.vertex], triangles: [[0, 1, 2]] },
          binding: seed.declaration.name,
          scale: { _tag: "DayRange" },
          motion: Option.some({ nodes: [{ _tag: "Reading", binding: seed.declaration.name }], output: 0 }),
        },
        {
          _tag: "Decoration",
          id: "body",
          material: { _tag: "Decorative", slot: "enamel" },
          surface: "body-face",
          socket: Option.none(),
          geometry: { vertices: [], triangles: [] },
          motion: Option.some({ nodes: [{ _tag: "Time" }], output: 0 }),
        },
      ],
      behaviours: [{
        states: ["idle", "active"],
        initial: "idle",
        transitions: [{ from: "idle", event: "newHigh", to: "active" }],
      }],
      textures: [],
    },
    budget: { triangles: 1, parts: 2, animatedNodes: 2, texturePixels: 0 },
  })
));
test("pieces and both part variants round trip schema-derived output", () =>
  runTest(
    Arbitrary.checkEffect(pieceArbitrary, (piece) =>
      Effect.gen(function*() {
        if (!(yield* roundTrip(Piece, piece))) return false;
        for (const part of piece.output.parts) {
          if (!(yield* roundTrip(PiecePart, part))) return false;
        }
        return true;
      }), options).pipe(Effect.tap(expectPassed)),
  ));
test("pieces reject foreign-token or tokenless bindings and incorrect budget figures", () =>
  runTest(
    Arbitrary.checkEffect(pieceArbitrary, (piece) =>
      !Schema.is(Piece)({ ...piece, plot: { ...piece.plot, token: Option.none() } })
      && !Schema.is(Piece)({
        ...piece,
        bindings: piece.bindings.map((binding) => ({ ...binding, token: AssetRef.make("other:chain/token:value") })),
      })
      && !Schema.is(Piece)({ ...piece, budget: { ...piece.budget, triangles: 2 } })
      && !Schema.is(Piece)({ ...piece, budget: { ...piece.budget, animatedNodes: 0 } }), options).pipe(
        Effect.tap(expectPassed),
      ),
  ));
test("pieces reject undeclared readings, disguised brass and non-brass live motion", () =>
  runTest(
    Arbitrary.checkEffect(pieceArbitrary, (piece) => {
      const changed = (parts: ReadonlyArray<unknown>) =>
        Schema.is(Piece)({ ...piece, output: { ...piece.output, parts } });
      return !changed(
        piece.output.parts.map((part) =>
          part._tag === "Instrument"
            ? { ...part, material: { _tag: "Decorative", slot: "enamel" } }
            : part
        ),
      )
        && !changed(
          piece.output.parts.map((part) =>
            part._tag === "Decoration"
              ? { ...part, material: { _tag: "Brass", slot: "brassDark" } }
              : part
          ),
        )
        && !changed(
          piece.output.parts.map((part) => ({
            ...part,
            motion: Option.some({ nodes: [{ _tag: "Reading", binding: "undeclared" }], output: 0 }),
          })),
        );
    }, options).pipe(Effect.tap(expectPassed)),
  ));

// Each mutation starts from a valid piece and breaks one rule. Combining two
// faults could let a surviving check conceal the removal of the other one.
const rejectPieceMutation = (name: string, mutate: (piece: Piece) => object) =>
  test(name, () =>
    runTest(
      Arbitrary.checkEffect(pieceArbitrary, (piece) =>
        Schema.is(Piece)(piece) && !Schema.is(Piece)(mutate(piece)), options).pipe(Effect.tap(expectPassed)),
    ));

rejectPieceMutation(
  "binding names must be unique",
  (piece) => ({ ...piece, bindings: [...piece.bindings, ...piece.bindings] }),
);
rejectPieceMutation("socket names must be unique", (piece) => ({
  ...piece,
  sockets: Array.from({ length: 2 }, () => ({ name: "pin", position: [0, 0, 0], permission: { _tag: "Public" } })),
}));
rejectPieceMutation("part IDs must be unique", (piece) => ({
  ...piece,
  output: { ...piece.output, parts: piece.output.parts.map((part) => ({ ...part, id: "same" })) },
}));
rejectPieceMutation("texture IDs must be unique", (piece) => ({
  ...piece,
  output: {
    ...piece.output,
    textures: Array.from({ length: 2 }, () => ({ id: "paper", contentDigest: "digest", width: 2, height: 3 })),
  },
  budget: { ...piece.budget, texturePixels: 12 },
}));
rejectPieceMutation(
  "part budget must equal output part count",
  (piece) => ({ ...piece, budget: { ...piece.budget, parts: 3 } }),
);
rejectPieceMutation("texture pixel budget must equal output dimensions", (piece) => ({
  ...piece,
  output: { ...piece.output, textures: [{ id: "paper", contentDigest: "digest", width: 2, height: 3 }] },
}));
rejectPieceMutation("local attachments require a declared socket", (piece) => ({
  ...piece,
  output: {
    ...piece.output,
    parts: piece.output.parts.map((part) => ({
      ...part,
      socket: Option.some({ _tag: "LocalSocket", name: "missing" }),
    })),
  },
}));
rejectPieceMutation("an unanimated instrument still requires a declared binding", (piece) => ({
  ...piece,
  output: {
    ...piece.output,
    parts: piece.output.parts.map((part) =>
      part._tag === "Instrument"
        ? { ...part, binding: "missing", motion: Option.none() }
        : part
    ),
  },
  budget: { ...piece.budget, animatedNodes: 1 },
}));
rejectPieceMutation("live motion cannot drive a decorative part", (piece) => ({
  ...piece,
  output: {
    ...piece.output,
    parts: piece.output.parts.map((part) =>
      part._tag === "Decoration"
        ? {
          ...part,
          motion: Option.some({
            nodes: piece.bindings.map((binding) => ({ _tag: "Reading", binding: binding.name })),
            output: 0,
          }),
        }
        : part
    ),
  },
}));
rejectPieceMutation("an instrument cannot follow another declared reading", (piece) => ({
  ...piece,
  bindings: piece.bindings.flatMap((binding) => [{ ...binding, name: "price" }, { ...binding, name: "holders" }]),
  output: {
    ...piece.output,
    parts: piece.output.parts.map((part) =>
      part._tag === "Instrument"
        ? {
          ...part,
          binding: "price",
          motion: Option.some({ nodes: [{ _tag: "Reading", binding: "holders" }], output: 0 }),
        }
        : part
    ),
  },
}));
rejectPieceMutation("an instrument's output must reach its engraved reading", (piece) => ({
  ...piece,
  output: {
    ...piece.output,
    parts: piece.output.parts.map((part) =>
      part._tag === "Instrument"
        ? {
          ...part,
          motion: Option.some({ nodes: [{ _tag: "Reading", binding: part.binding }, { _tag: "Time" }], output: 1 }),
        }
        : part
    ),
  },
}));
rejectPieceMutation("an instrument cannot mix its engraved reading with another binding", (piece) => ({
  ...piece,
  bindings: piece.bindings.flatMap((binding) => [{ ...binding, name: "price" }, { ...binding, name: "holders" }]),
  output: {
    ...piece.output,
    parts: piece.output.parts.map((part) =>
      part._tag === "Instrument"
        ? {
          ...part,
          binding: "price",
          motion: Option.some({
            nodes: [
              { _tag: "Reading", binding: "price" },
              { _tag: "Reading", binding: "holders" },
              { _tag: "Binary", operation: "add", left: 0, right: 1 },
            ],
            output: 2,
          }),
        }
        : part
    ),
  },
}));

test("a tokenless piece accepts decoration and rejects only token behaviours", () =>
  runTest(
    Arbitrary.checkEffect(pieceArbitrary, (piece) => {
      const tokenless = {
        ...piece,
        plot: { ...piece.plot, token: Option.none() },
        bindings: [],
        output: {
          ...piece.output,
          parts: piece.output.parts.filter((part) => part._tag === "Decoration"),
          behaviours: [],
        },
        budget: { parts: 1, triangles: 0, animatedNodes: 1, texturePixels: 0 },
      };
      return Schema.is(Piece)(tokenless)
        && !Schema.is(Piece)({ ...tokenless, output: { ...tokenless.output, behaviours: piece.output.behaviours } });
    }, options).pipe(Effect.tap(expectPassed)),
  ));

test("an instrument may transform its reading through the expression graph", () =>
  runTest(
    Arbitrary.checkEffect(pieceArbitrary, (piece) =>
      Schema.is(Piece)({
        ...piece,
        output: {
          ...piece.output,
          parts: piece.output.parts.map((part) =>
            part._tag === "Instrument"
              ? {
                ...part,
                motion: Option.some({
                  nodes: [
                    { _tag: "Reading", binding: part.binding },
                    { _tag: "Time" },
                    { _tag: "Constant", value: 0 },
                    { _tag: "Unary", operation: "abs", input: 0 },
                    { _tag: "Binary", operation: "add", left: 1, right: 3 },
                    { _tag: "Clamp", input: 4, minimum: 2, maximum: 0 },
                  ],
                  output: 5,
                }),
              }
              : part
          ),
        },
      }), options).pipe(Effect.tap(expectPassed)),
  ));

test("driver node limits include both boundaries", () => {
  const nodes = Array.from({ length: 128 }, () => DriverNode.cases.Time.make({}));
  expect(Schema.is(Driver)({ nodes, output: 127 })).toBe(true);
  expect(Schema.is(Driver)({ nodes: [...nodes, DriverNode.cases.Time.make({})], output: 127 })).toBe(false);
  expect(Schema.is(Driver)({ nodes: [], output: 0 })).toBe(false);
});
test.each([
  ["binary left", { _tag: "Binary", operation: "add", left: 1, right: 0 }],
  ["binary right", { _tag: "Binary", operation: "add", left: 0, right: 2 }],
  ["clamp input", { _tag: "Clamp", input: 1, minimum: 0, maximum: 0 }],
  ["clamp minimum", { _tag: "Clamp", input: 0, minimum: 2, maximum: 0 }],
  ["clamp maximum", { _tag: "Clamp", input: 0, minimum: 0, maximum: 1 }],
])("driver %s must refer to an earlier node", (_name, node) => {
  expect(Schema.is(Driver)({ nodes: [{ _tag: "Time" }, node, { _tag: "Time" }], output: 1 })).toBe(false);
});
test("geometry vertex and triangle limits include both boundaries", () => {
  const vertices = Array.from({ length: 65536 }, () => [0, 0, 0]);
  const triangles = Array.from({ length: 65536 }, () => [0, 0, 0]);
  expect(Schema.is(Geometry)({ vertices, triangles })).toBe(true);
  expect(Schema.is(Geometry)({ vertices: [...vertices, [0, 0, 0]], triangles })).toBe(false);
  expect(Schema.is(Geometry)({ vertices, triangles: [...triangles, [0, 0, 0]] })).toBe(false);
});
test.each([
  ["source", "missing", "idle"],
  ["target", "idle", "missing"],
])("behaviour transition %s must be declared", (_name, from, to) => {
  expect(
    Schema.is(Behaviour)({
      states: ["idle"],
      initial: "idle",
      transitions: [{ from, event: "newHigh", to }],
    }),
  ).toBe(false);
});
test.each(["brass", "Brass", "brass ", "brassDark", "enamel"])("material semantics use the tag for slot %s", (slot) => {
  expect(Schema.is(PieceMaterial)({ _tag: "Brass", slot })).toBe(true);
  expect(Schema.is(PieceMaterial)({ _tag: "Decorative", slot })).toBe(true);
  expect(Schema.is(PieceMaterial)(slot)).toBe(false);
});
