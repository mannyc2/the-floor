import { expect, test } from "bun:test";
import * as Testing from "effect-oxlint/testing";
import {
  appIsolation,
  atlasLiterals,
  contractIsolation,
  dataReads,
  featureIsolation,
  legacyDependencies,
  productionFixtures,
  referenceIsolation,
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

test("fixtures are test-owned and the historical snapshot never becomes code", () => {
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
    Testing.runRule(
      referenceIsolation,
      "ImportDeclaration",
      Testing.importDecl("../reference/first-build/index"),
      context("scripts/runner.ts"),
    ),
  ).toHaveLength(1);
  expect(
    Testing.runRule(
      referenceIsolation,
      "ImportDeclaration",
      Testing.importDecl("../reference/approved.png"),
      context("testing/look/runner.ts"),
    ),
  ).toHaveLength(0);
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
      Testing.callExpr("join", [Testing.strLiteral("reference"), Testing.strLiteral("first-build")]),
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
        Testing.strLiteral("reference/first-build/data.json"),
        Testing.strLiteral("assets/data.json"),
      ]),
      context("scripts/copy.ts"),
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

test("Atlas checks inspect CSS embedded in template strings", () => {
  expect(Testing.runRule(atlasLiterals, "TemplateElement", {
    value: { raw: "padding: 24px; color: #ff8800", cooked: "padding: 24px; color: #ff8800" },
    tail: true,
  }, context("apps/web/src/view.ts"))).toHaveLength(1);
});

test("recursive copy is covered by the historical-read fence", () => {
  for (const name of ["cp", "cpSync"]) {
    expect(Testing.runRule(
      dataReads,
      "CallExpression",
      Testing.callOfMember("fs", name, [
        Testing.strLiteral("reference/first-build/assets"),
        Testing.strLiteral("assets"),
      ]),
      context("scripts/copy.ts"),
    )).toHaveLength(1);
  }
});
