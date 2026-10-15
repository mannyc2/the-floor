import { expect, test } from "bun:test";
import * as Testing from "effect-oxlint/testing";
import { appIsolation, atlasLiterals, featureIsolation } from "../plugin";

const context = (filename: string) => ({ filename: `/floor/${filename}`, cwd: "/floor" });

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

test("Atlas checks inspect CSS embedded in template strings", () => {
  expect(Testing.runRule(atlasLiterals, "TemplateElement", {
    value: { raw: "padding: 24px; color: #ff8800", cooked: "padding: 24px; color: #ff8800" },
    tail: true,
  }, context("apps/web/src/view.ts"))).toHaveLength(1);
});

test("ownership checks reject module forms the native import restrictions cannot inspect", () => {
  for (const filename of ["apps/floor/src/worker.ts", "packages/wallets/test/oracle.test.ts"]) {
    const file = context(filename);
    for (
      const source of [Testing.id("moduleName"), {
        type: "TemplateLiteral",
        expressions: [],
        quasis: [{ type: "TemplateElement", value: { raw: "@privy-io/node", cooked: "@privy-io/node" }, tail: true }],
      }]
    ) {
      expect(Testing.runRule(appIsolation, "ImportExpression", { source }, file)).toHaveLength(1);
    }
    expect(Testing.runRule(appIsolation, "TSImportType", { source: Testing.strLiteral("@privy-io/node") }, file))
      .toHaveLength(1);
    expect(
      Testing.runRule(
        appIsolation,
        "CallExpression",
        Testing.callExpr("require", [Testing.strLiteral("@privy-io/node")]),
        file,
      ),
    ).toHaveLength(1);
    expect(Testing.runRule(appIsolation, "ImportExpression", { source: Testing.strLiteral("effect") }, file))
      .toHaveLength(0);
  }
});
