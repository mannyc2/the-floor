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
          material: "brass",
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
          material: "enamel",
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
        piece.output.parts.map((part) => part._tag === "Instrument" ? { ...part, material: "enamel" } : part),
      )
        && !changed(
          piece.output.parts.map((part) => part._tag === "Decoration" ? { ...part, material: "Brass" } : part),
        )
        && !changed(
          piece.output.parts.map((part) => ({
            ...part,
            motion: Option.some({ nodes: [{ _tag: "Reading", binding: "undeclared" }], output: 0 }),
          })),
        );
    }, options).pipe(Effect.tap(expectPassed)),
  ));
