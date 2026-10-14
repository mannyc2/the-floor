import { expect, test } from "bun:test";
import * as Testing from "effect-oxlint/testing";
import plugin, {
  appIsolation,
  atlasLiterals,
  contractIsolation,
  dataReads,
  featureIsolation,
  legacyDependencies,
  oracleDependencies,
  productionFixtures,
  signerIsolation,
  staticModules,
  threeIsolation,
} from "../plugin";

const context = (filename: string) => ({ filename: `/floor/${filename}`, cwd: "/floor" });

test("contract closes every import and re-export form", () => {
  const file = context("packages/contract/src/index.ts");
  for (const source of ["effect", "effect/Schema", "./_lib/amount"]) {
    expect(Testing.runRule(contractIsolation, "ImportDeclaration", Testing.importDecl(source), file)).toHaveLength(0);
  }
  for (const source of ["viem", "@floor/chains", "../../chains/src/solana"]) {
    for (
      const visitor of [
        "ImportDeclaration",
        "ExportAllDeclaration",
        "ExportNamedDeclaration",
        "ImportExpression",
        "TSImportType",
      ]
    ) {
      expect(Testing.runRule(contractIsolation, visitor, { source: Testing.strLiteral(source) }, file)).toHaveLength(1);
    }
    expect(
      Testing.runRule(contractIsolation, "TSExternalModuleReference", { expression: Testing.strLiteral(source) }, file),
    ).toHaveLength(1);
    expect(
      Testing.runRule(
        contractIsolation,
        "CallExpression",
        Testing.callExpr("require", [Testing.strLiteral(source)]),
        file,
      ),
    ).toHaveLength(1);
  }
});

test("apps and features cannot cross their ownership boundaries", () => {
  expect(
    Testing.runRule(
      appIsolation,
      "ImportDeclaration",
      Testing.importDecl("../../floor/src/worker"),
      context("apps/web/src/entry.ts"),
    ),
  ).toHaveLength(1);
  expect(
    Testing.runRule(
      appIsolation,
      "ImportDeclaration",
      Testing.importDecl("@floor/app-floor"),
      context("packages/chains/src/evm.ts"),
    ),
  ).toHaveLength(1);
  expect(
    Testing.runRule(
      appIsolation,
      "ImportDeclaration",
      Testing.importDecl("@floor/app-floor"),
      context("alchemy.run.ts"),
    ),
  ).toHaveLength(0);
  const file = context("apps/web/src/review/_components/panel.ts");
  for (const source of ["../../map/view", "@floor/web/map/view"]) {
    expect(Testing.runRule(featureIsolation, "ImportDeclaration", Testing.importDecl(source), file)).toHaveLength(1);
  }
  for (const source of ["./row", "../view", "@floor/contract", "../../_components/button"]) {
    expect(Testing.runRule(featureIsolation, "ImportDeclaration", Testing.importDecl(source), file)).toHaveLength(0);
  }
});

test("signer excludes agent authority and Three stays in web", () => {
  for (
    const source of [
      "@yielded/agent",
      "@effect/ai-anthropic",
      "effect/ai/LanguageModel",
      "openai",
      "@anthropic-ai/sdk",
      "@floor/app-floor",
    ]
  ) {
    expect(
      Testing.runRule(
        signerIsolation,
        "ImportDeclaration",
        Testing.importDecl(source),
        context("apps/signer/src/worker.ts"),
      ),
    ).toHaveLength(1);
  }
  for (const filename of ["apps/floor/src/worker.ts", "packages/world/src/index.ts", "testing/look/runner.ts"]) {
    for (const source of ["three", "three/webgpu", "three-edge-projection", "three-mesh-bvh"]) {
      expect(Testing.runRule(threeIsolation, "ImportDeclaration", Testing.importDecl(source), context(filename)))
        .toHaveLength(1);
    }
  }
  expect(
    Testing.runRule(
      threeIsolation,
      "ImportDeclaration",
      Testing.importDecl("three"),
      context("apps/web/test/projector.ts"),
    ),
  ).toHaveLength(0);
});

test("fixtures are test-owned and never become production code", () => {
  for (
    const source of [
      "@yielded/agent-testing",
      "@floor/chains/testing",
      "../test/fixture",
      "../../workbench/entry",
      "./fixtures/input.json",
      "./action.test",
      "./action.spec",
    ]
  ) {
    expect(
      Testing.runRule(
        productionFixtures,
        "ImportDeclaration",
        Testing.importDecl(source),
        context("apps/floor/src/worker.ts"),
      ),
    ).toHaveLength(1);
    expect(
      Testing.runRule(
        productionFixtures,
        "ImportDeclaration",
        Testing.importDecl(source),
        context("apps/floor/test/worker.test.ts"),
      ),
    ).toHaveLength(0);
  }
  expect(
    Testing.runRule(productionFixtures, "ImportDeclaration", Testing.importDecl("./real-data"), {
      cwd: "/testing/floor",
      filename: "/testing/floor/apps/floor/src/worker.ts",
    }),
  ).toHaveLength(0);
});

test("nonliteral dependencies and opaque file reads fail closed", () => {
  const file = context("apps/floor/src/worker.ts");
  expect(Testing.runRule(staticModules, "ImportExpression", { source: Testing.id("path") }, file)).toHaveLength(1);
  expect(Testing.runRule(staticModules, "ImportExpression", { source: Testing.strLiteral("effect") }, file))
    .toHaveLength(0);
  expect(Testing.runRule(staticModules, "CallExpression", Testing.callExpr("require", [Testing.id("path")]), file))
    .toHaveLength(1);
  for (
    const target of [
      Testing.id("path"),
      Testing.callExpr("join", [Testing.strLiteral("assets"), Testing.id("path")]),
      Testing.strLiteral("testing/fixtures/pool.json"),
      Testing.callExpr("join", [Testing.strLiteral("testing"), Testing.strLiteral("fixtures")]),
    ]
  ) {
    expect(
      Testing.runRule(
        dataReads,
        "CallExpression",
        Testing.callOfMember("fs", "readFileString", [target, Testing.strLiteral("utf8")]),
        file,
      ),
    ).toHaveLength(1);
  }
  expect(
    Testing.runRule(
      dataReads,
      "CallExpression",
      Testing.callOfMember("fs", "copyFile", [
        Testing.strLiteral("testing/recordings/data.json"),
        Testing.strLiteral("assets/data.json"),
      ]),
      file,
    ),
  ).toHaveLength(1);
  expect(
    Testing.runRule(
      dataReads,
      "CallExpression",
      Testing.callOfMember("fs", "readFileString", [Testing.strLiteral("assets/palette.json")]),
      file,
    ),
  ).toHaveLength(0);
});

test("visual literals require Atlas ownership", () => {
  for (const value of ["#fc5", "rgb(1, 2, 3)", "width: 24px"]) {
    expect(Testing.runRule(atlasLiterals, "Literal", Testing.strLiteral(value), context("apps/web/src/view.ts")))
      .toHaveLength(1);
    expect(
      Testing.runRule(atlasLiterals, "Literal", Testing.strLiteral(value), context("packages/atlas/src/palette.ts")),
    ).toHaveLength(0);
  }
  expect(
    Testing.runRule(atlasLiterals, "Literal", Testing.strLiteral("var(--atlas-line)"), context("apps/web/src/view.ts")),
  ).toHaveLength(0);
});

test("legacy SDKs stay confined to development oracles", () => {
  for (
    const source of [
      "effect-cf",
      "@solana/web3.js",
      "@coral-xyz/anchor",
      "bn.js",
      "@meteora-ag/dynamic-bonding-curve-sdk",
      "@whetstone-research/doppler-sdk",
    ]
  ) {
    expect(
      Testing.runRule(
        legacyDependencies,
        "ImportDeclaration",
        Testing.importDecl(source),
        context("packages/chains/src/solana.ts"),
      ),
    ).toHaveLength(1);
    expect(
      Testing.runRule(
        legacyDependencies,
        "ImportDeclaration",
        Testing.importDecl(source),
        context("packages/chains/test/oracle.test.ts"),
      ),
    ).toHaveLength(0);
  }
});

const oracleImportForms = (source: string) => [
  ...["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration", "ImportExpression", "TSImportType"].map(
    visitor => ({ visitor, node: { source: Testing.strLiteral(source) } }),
  ),
  { visitor: "TSExternalModuleReference", node: { expression: Testing.strLiteral(source) } },
  { visitor: "CallExpression", node: Testing.callExpr("require", [Testing.strLiteral(source)]) },
  {
    visitor: "ImportExpression",
    node: {
      source: {
        type: "TemplateLiteral",
        expressions: [],
        quasis: [{ type: "TemplateElement", value: { raw: source, cooked: source }, tail: true }],
      },
    },
  },
];

test("wallet oracle imports and re-exports are excluded from every production owner", () => {
  expect(plugin.rules["oracle-dependencies"]).toBe(oracleDependencies);
  for (
    const filename of [
      "apps/web/src/entry.ts",
      "apps/floor/src/worker.ts",
      "apps/signer/src/worker.ts",
      "packages/chains/src/solana/index.ts",
      "packages/wallets/src/privy/client.ts",
    ]
  ) {
    for (
      const source of [
        "@privy-io/node",
        "@privy-io/node/authorization",
        "svix",
        "svix/dist/index.js",
        "@hpke/core",
        "@hpke/chacha20poly1305",
        "../../node_modules/@privy-io/node/index.mjs",
      ]
    ) {
      for (const { visitor, node } of oracleImportForms(source)) {
        expect(Testing.runRule(oracleDependencies, visitor, node, context(filename))).toHaveLength(1);
        expect(Testing.runRule(oracleDependencies, visitor, node, context("packages/wallets/test/oracle.test.ts")))
          .toHaveLength(0);
      }
    }
    for (
      const source of ["effect/http/HttpClient", "@floor/wallets", "@solana/kit", "@privy-io/node-other", "svix-other"]
    ) {
      for (const { visitor, node } of oracleImportForms(source)) {
        expect(Testing.runRule(oracleDependencies, visitor, node, context(filename))).toHaveLength(0);
      }
    }
  }
});

test("the SDK Solana helper is forbidden even in development oracles", () => {
  for (
    const filename of [
      "packages/wallets/src/privy/client.ts",
      "packages/wallets/test/oracle.test.ts",
      "scripts/probe.ts",
    ]
  ) {
    for (
      const source of [
        "@privy-io/node/solana-kit",
        "@privy-io/node/solana-kit/index",
        "@privy-io/node/lib/solana-kit.mjs",
      ]
    ) {
      for (const { visitor, node } of oracleImportForms(source)) {
        expect(Testing.runRule(oracleDependencies, visitor, node, context(filename))).toHaveLength(1);
      }
    }
  }
});

test("Atlas checks inspect CSS embedded in template strings", () => {
  expect(Testing.runRule(atlasLiterals, "TemplateElement", {
    value: { raw: "padding: 24px; color: #ff8800", cooked: "padding: 24px; color: #ff8800" },
    tail: true,
  }, context("apps/web/src/view.ts"))).toHaveLength(1);
});

test("recursive copy is covered by the testing-data fence", () => {
  for (const name of ["cp", "cpSync"]) {
    expect(Testing.runRule(
      dataReads,
      "CallExpression",
      Testing.callOfMember("fs", name, [
        Testing.strLiteral("testing/fixtures"),
        Testing.strLiteral("assets"),
      ]),
      context("apps/floor/src/worker.ts"),
    )).toHaveLength(1);
  }
});
