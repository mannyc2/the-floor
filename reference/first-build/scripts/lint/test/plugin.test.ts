import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Testing from "effect-oxlint/testing";
import {
  contractIsolation,
  frontendFeatureIsolation,
  productionFixtures,
  signingIsolation,
  staticModuleDependencies,
} from "../plugin";

const context = (filename: string) => ({ filename: `/floor/${filename}`, cwd: "/floor" });
it.effect("keeps the contract closed across imports, re-exports and type imports", () =>
  Effect.sync(() => {
    const file = context("packages/contract/src/index.ts");
    for (const allowed of ["effect", "effect/Schema", "./_lib/amount"]) {
      expect(Testing.runRule(contractIsolation, "ImportDeclaration", Testing.importDecl(allowed), file)).toHaveLength(
        0,
      );
    }
    for (const forbidden of ["viem", "@floor/markets", "../../agents/src/runtime"]) {
      expect(Testing.runRule(contractIsolation, "ImportDeclaration", Testing.importDecl(forbidden), file)).toHaveLength(
        1,
      );
    }
    expect(
      Testing.runRule(contractIsolation, "ExportAllDeclaration", { source: Testing.strLiteral("@floor/agents") }, file),
    ).toHaveLength(1);
    expect(Testing.runRule(contractIsolation, "TSImportType", { source: Testing.strLiteral("@floor/agents") }, file))
      .toHaveLength(1);
  }));
it.effect("keeps inference and agent capability outside signing", () =>
  Effect.sync(() => {
    const file = context("packages/signing/src/index.ts");
    for (
      const forbidden of [
        "@floor/agents",
        "../../agents/src/runtime",
        "@yielded/agent",
        "@effect/ai-openai",
        "effect/ai/LanguageModel",
        "openai",
      ]
    ) {
      expect(Testing.runRule(signingIsolation, "ImportDeclaration", Testing.importDecl(forbidden), file)).toHaveLength(
        1,
      );
    }
    for (const allowed of ["effect", "viem", "@floor/contract", "./journal"]) {
      expect(Testing.runRule(signingIsolation, "ImportDeclaration", Testing.importDecl(allowed), file)).toHaveLength(0);
    }
    expect(Testing.runRule(signingIsolation, "ImportExpression", { source: Testing.strLiteral("@floor/agents") }, file))
      .toHaveLength(1);
  }));
it.effect("rejects test data in production but allows test-owned imports", () =>
  Effect.sync(() => {
    const file = context("packages/markets/src/runtime.ts");
    for (
      const forbidden of [
        "../../../testing/recordings/base-day.json",
        "../test/_fixtures/base-chain",
        "./testing/provider",
      ]
    ) {
      expect(Testing.runRule(productionFixtures, "ImportDeclaration", Testing.importDecl(forbidden), file))
        .toHaveLength(1);
    }
    expect(Testing.runRule(productionFixtures, "ImportDeclaration", Testing.importDecl("./base-chain"), file))
      .toHaveLength(0);
    expect(
      Testing.runRule(productionFixtures, "ImportDeclaration", Testing.importDecl("./base-chain"), {
        filename: "/testing/floor/packages/markets/src/runtime.ts",
        cwd: "/testing/floor",
      }),
    ).toHaveLength(0);
    expect(
      Testing.runRule(
        productionFixtures,
        "ImportDeclaration",
        Testing.importDecl("./fixture"),
        context("packages/markets/src/testing/reader.ts"),
      ),
    ).toHaveLength(0);
    expect(
      Testing.runRule(
        productionFixtures,
        "ImportDeclaration",
        Testing.importDecl("../../../testing/recordings/base-day.json"),
        context("packages/markets/test/reader.test.ts"),
      ),
    ).toHaveLength(0);
  }));
it.effect("resolves relative and aliased frontend feature edges", () =>
  Effect.sync(() => {
    const file = context("packages/frontend/src/atlas/_components/panel.ts");
    for (const forbidden of ["../../desk/view", "@/desk/view", "@frontend/desk/view", "@floor/frontend/desk/view"]) {
      expect(Testing.runRule(frontendFeatureIsolation, "ImportDeclaration", Testing.importDecl(forbidden), file))
        .toHaveLength(1);
    }
    for (const allowed of ["./chart", "../view", "@/_components/ui", "@/message", "@floor/markets/schema"]) {
      expect(Testing.runRule(frontendFeatureIsolation, "ImportDeclaration", Testing.importDecl(allowed), file))
        .toHaveLength(0);
    }
    expect(
      Testing.runRule(
        frontendFeatureIsolation,
        "ImportDeclaration",
        Testing.importDecl("./desk/view"),
        context("packages/frontend/src/view.ts"),
      ),
    ).toHaveLength(0);
  }));
it.effect("checks static dynamic imports and rejects uncheckable dependency expressions", () =>
  Effect.sync(() => {
    const file = context("packages/signing/src/index.ts");
    expect(
      Testing.runRule(staticModuleDependencies, "ImportExpression", { source: Testing.strLiteral("effect") }, file),
    ).toHaveLength(0);
    expect(
      Testing.runRule(staticModuleDependencies, "ImportExpression", { source: Testing.id("untrustedModule") }, file),
    ).toHaveLength(1);
    expect(
      Testing.runRule(
        staticModuleDependencies,
        "CallExpression",
        Testing.callExpr("require", [Testing.id("untrustedModule")]),
        file,
      ),
    ).toHaveLength(1);
    expect(
      Testing.runRule(
        signingIsolation,
        "CallExpression",
        Testing.callExpr("require", [Testing.strLiteral("@floor/agents")]),
        file,
      ),
    ).toHaveLength(1);
  }));
