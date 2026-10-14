import { expect, test } from "bun:test";
import type { ESTree } from "effect-oxlint";
import * as Testing from "effect-oxlint/testing";
import { chainNeutralSchemas } from "../chain-neutral-schemas";

const schemaImport = (
  local = "Schema",
  source = "effect",
  imported = "Schema",
): ReturnType<typeof Testing.variable> => ({
  ...Testing.variable(local),
  defs: [{
    type: "ImportBinding",
    name: Testing.id(local),
    parent: Testing.importDecl(source),
    node: {
      ...Testing.id(local),
      type: "ImportSpecifier",
      imported: Testing.id(imported),
      local: Testing.id(local),
    },
  }],
});
const constant = (name: string, init: ESTree.Node): ReturnType<typeof Testing.variable> => ({
  ...Testing.variable(name),
  defs: [{
    type: "Variable",
    name: Testing.id(name),
    node: Testing.varDeclarator(name, init),
    parent: Testing.varDecl("const", name, init),
  }],
});
const regex = (pattern: string): ESTree.RegExpLiteral => ({
  ...Testing.strLiteral(pattern),
  value: /fixture/,
  regex: { pattern, flags: "" },
});
const run = (
  nodes: readonly (ESTree.CallExpression | ESTree.VariableDeclarator)[],
  options: {
    readonly file?: string;
    readonly bindings?: readonly ReturnType<typeof Testing.variable>[];
  } = {},
) => {
  const mock = Testing.createMockContext({
    filename: "/floor/" + (options.file ?? "packages/contract/src/model.ts"),
    cwd: "/floor",
  });
  const scope = Testing.scope({ variables: options.bindings ?? [schemaImport()] });
  const visitors = chainNeutralSchemas.create({
    ...mock.context,
    sourceCode: { ...mock.context.sourceCode, getScope: () => scope },
  });
  for (const node of nodes) {
    if (node.type === "CallExpression") visitors["CallExpression"]?.(node);
    if (node.type === "VariableDeclarator") visitors["VariableDeclarator"]?.(node);
  }
  return mock.diagnostics;
};
const fieldSchema = (key: string, namespace = "Schema") =>
  Testing.callOfMember(namespace, "Struct", [
    Testing.objectExpr([{ key, value: Testing.memberExpr(namespace, "Int") }]),
  ]);

test("chain encodings are rejected in contract, app, wallet and shared-chain Schemas", () => {
  for (
    const file of [
      "packages/contract/src/model.ts",
      "apps/floor/src/model.ts",
      "packages/wallets/src/privy/client.ts",
      "packages/chains/src/shared.ts",
      "packages/chains/src/testing/fixture.ts",
    ]
  ) {
    for (const key of ["block", "blockNumber", "block_height", "lamports", "gasWei", "fee_gwei", "satoshis"]) {
      expect(run([fieldSchema(key)], { file })).toHaveLength(1);
    }
  }
  for (const file of ["packages/chains/src/solana/model.ts", "packages/chains/src/evm/validation.ts"]) {
    expect(run([fieldSchema("lamports")], { file })).toHaveLength(0);
  }
  for (const file of ["packages/chains/src/evm-like/model.ts", "packages/contract/src/evm/model.ts"]) {
    expect(run([fieldSchema("blockNumber")], { file })).toHaveLength(1);
  }
});

test("hex patterns and unit literals are schema-specific, including local constant constraints", () => {
  for (const pattern of ["^0x[0-9a-fA-F]{40}$", "^0[xX][0-9a-f]+$", "^0X[0-9a-f]+$"]) {
    expect(run([Testing.callOfMember("Schema", "isPattern", [regex(pattern)])])).toHaveLength(1);
    expect(run([Testing.callOfMember("Schema", "isPattern", [Testing.id("pattern")])], {
      bindings: [schemaImport(), constant("pattern", regex(pattern))],
    })).toHaveLength(1);
  }
  expect(
    run([
      Testing.callOfMember("Schema", "TemplateLiteral", [
        Testing.strLiteral("0x"),
        Testing.memberExpr("Schema", "String"),
      ]),
    ]),
  ).toHaveLength(1);
  expect(run([Testing.callOfMember("Schema", "Literal", [Testing.strLiteral("lamports")])])).toHaveLength(1);
  expect(run([Testing.varDeclarator("BlockNumber", Testing.memberExpr("Schema", "Int"))])).toHaveLength(1);
  expect(run([Testing.varDeclarator("Block", Testing.memberExpr("Schema", "Int"))])).toHaveLength(1);
  expect(run([Testing.varDeclarator("AmountLamports", Testing.memberExpr("Schema", "BigInt"))])).toHaveLength(1);
  expect(
    run([
      Testing.varDeclarator(
        "BlockNumber",
        Testing.callOfMember("Schema", "optional", [Testing.memberExpr("Schema", "Int")]),
      ),
    ]),
  ).toHaveLength(1);
  expect(run([Testing.callOfMember("Schema", "isStartingWith", [Testing.strLiteral("0x")])])).toHaveLength(1);
});

test("schema predicates cannot hide a chain pattern in a callback", () => {
  const predicate = {
    ...Testing.arrowFn(),
    body: {
      ...Testing.callOfMember("pattern", "test", [Testing.id("value")]),
      callee: { ...Testing.memberExpr("pattern", "test"), object: regex("^0x") },
    },
  };
  expect(run([Testing.callOfMember("Schema", "makeFilter", [predicate])])).toHaveLength(1);
});

test("actual imports and aliases determine schema authority", () => {
  expect(run([fieldSchema("lamports", "S")], { bindings: [schemaImport("S")] })).toHaveLength(1);
  expect(run([fieldSchema("lamports")], { bindings: [schemaImport("Schema", "unrelated-package")] })).toHaveLength(0);
  expect(run([fieldSchema("lamports")], { bindings: [Testing.variable("Schema")] })).toHaveLength(0);
  expect(run([Testing.callExpr("struct", [Testing.objectExpr([{ key: "blockNumber" }])])], {
    bindings: [schemaImport("struct", "effect/Schema", "Struct")],
  })).toHaveLength(1);
  expect(run([fieldSchema("lamports", "S")], {
    bindings: [schemaImport(), constant("S", Testing.id("Schema"))],
  })).toHaveLength(1);
});

test("extracted field objects and recursive aliases cannot hide a constraint", () => {
  const fields = Testing.objectExpr([{ key: "blockNumber", value: Testing.memberExpr("Schema", "Int") }]);
  expect(run([Testing.callOfMember("Schema", "Struct", [Testing.id("fields")])], {
    bindings: [schemaImport(), constant("fields", fields)],
  })).toHaveLength(1);
  expect(run([Testing.callOfMember("Schema", "Struct", [Testing.id("cycle")])], {
    bindings: [schemaImport(), constant("cycle", Testing.id("cycle"))],
  })).toHaveLength(0);
});

test("neutral checkpoints, amounts and CAIP grammar remain valid", () => {
  const fields = Testing.objectExpr([
    { key: "chain", value: Testing.id("ChainRef") },
    { key: "height", value: Testing.memberExpr("Schema", "String") },
    { key: "hash", value: Testing.memberExpr("Schema", "String") },
    { key: "time", value: Testing.memberExpr("Schema", "DateTimeUtcFromString") },
    { key: "asset", value: Testing.id("AssetRef") },
    { key: "amount", value: Testing.memberExpr("Schema", "String") },
  ]);
  expect(run([Testing.callOfMember("Schema", "Struct", [fields])])).toHaveLength(0);
  expect(
    run([
      Testing.callOfMember("Schema", "isPattern", [
        regex("^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:[-.%a-zA-Z0-9]{1,128}$"),
      ]),
    ]),
  ).toHaveLength(0);
});

test("transaction data and annotation prose are not schema encodings", () => {
  const fixture = Testing.objectExpr([{ key: "blockNumber", value: Testing.numLiteral(42) }, {
    key: "lamports",
    value: Testing.numLiteral(1),
  }, { key: "address", value: Testing.strLiteral("0x123") }]);
  const decode = {
    ...Testing.callExpr("decode", [fixture]),
    callee: Testing.callOfMember("Schema", "decodeUnknownEffect", [Testing.id("Input")]),
  };
  expect(run([decode, Testing.callExpr("buildTransaction", [fixture])])).toHaveLength(0);
  expect(run([Testing.callOfMember("Schema", "isSchema", [fixture])])).toHaveLength(0);
  const annotation = {
    ...Testing.callOfMember("Address", "annotate", [
      Testing.objectExpr([{ key: "description", value: Testing.strLiteral("A 0x address is carried within CAIP-10") }]),
    ]),
    callee: { ...Testing.memberExpr("Address", "annotate"), object: Testing.memberExpr("Schema", "String") },
  };
  expect(run([annotation])).toHaveLength(0);
});

test("nested schema constraints report once at the offending node", () => {
  const nested = fieldSchema("lamports");
  const outer = Testing.callOfMember("Schema", "Struct", [Testing.objectExpr([{ key: "value", value: nested }])]);
  expect(run([outer, nested])).toHaveLength(1);
});
