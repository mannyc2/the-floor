import { Array, Effect, Option, Path, Schema } from "effect";
import { Diagnostic, type ESTree, Plugin, Rule, RuleContext, Visitor } from "effect-oxlint";
import { chainNeutralSchemas } from "./chain-neutral-schemas";
import { isTestingPath as testingPath } from "./paths";
import { hasVisualLiteral } from "./visual-values";

interface Boundary {
  readonly file: string;
  readonly source: string;
  readonly target: Option.Option<string>;
  readonly production: boolean;
}

interface BoundaryRule {
  readonly name: string;
  readonly description: string;
  readonly allSources?: boolean;
  readonly violation: (boundary: Boundary) => Option.Option<string>;
}

const within = (file: string, directory: string) => file === directory || file.startsWith(`${directory}/`);
const productionPath = (file: string) => /^(apps|packages)\/[^/]+\/src\//.test(file) && !testingPath(file);
const app = (file: string) => Option.fromUndefinedOr(/^apps\/([^/]+)\//.exec(file)?.[1]);
const feature = (file: string) =>
  Option.filter(
    Option.fromUndefinedOr(/^(?:apps|packages)\/[^/]+\/src\/([^/]+)\//.exec(file)?.[1]),
    name => !name.startsWith("_") && name !== "testing",
  );
const literal = (node: ESTree.Node): Option.Option<string> => {
  if (node.type === "Literal") return Schema.decodeUnknownOption(Schema.String)(node.value);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return Option.flatMap(Array.head(node.quasis), part => Option.fromNullishOr(part.value.cooked));
  }
  return Option.none();
};

const moduleVisitor = (rule: BoundaryRule) =>
  Effect.gen(function*() {
    const context = yield* RuleContext;
    const path = yield* Path.Path;
    const filename = path.resolve(context.cwd, context.filename.replaceAll("\\", "/"));
    const file = path.relative(context.cwd, filename);
    const production = productionPath(file);
    if (!production && rule.allSources !== true) return {};
    const target = (source: string): Option.Option<string> => {
      if (source.startsWith(".") || path.isAbsolute(source)) {
        return Option.some(path.relative(context.cwd, path.resolve(path.dirname(filename), source)));
      }
      if (source === "@floor/app-floor" || source.startsWith("@floor/app-floor/")) {
        return Option.some("apps/floor/src/" + source.slice("@floor/app-floor".length).replace(/^\//, ""));
      }
      if (source === "@floor/web" || source.startsWith("@floor/web/")) {
        return Option.some("apps/web/src/" + source.slice("@floor/web".length).replace(/^\//, ""));
      }
      if (source.startsWith("@floor/")) {
        const [name, ...rest] = source.slice("@floor/".length).split("/");
        return Option.map(Option.fromUndefinedOr(name), value => `packages/${value}/src/${rest.join("/")}`);
      }
      return Option.none();
    };
    const report = (node: ESTree.Node, source: string) =>
      Option.match(rule.violation({ file, source, target: target(source), production }), {
        onNone: () => Effect.void,
        onSome: message => context.report(Diagnostic.make({ node, message })),
      });
    const reportLiteral = (node: ESTree.Node, value: ESTree.Node) =>
      Option.match(literal(value), { onNone: () => Effect.void, onSome: source => report(node, source) });
    return Visitor.merge(
      Visitor.on("ImportDeclaration", node => report(node.source, node.source.value)),
      Visitor.on("ExportAllDeclaration", node => report(node.source, node.source.value)),
      Visitor.on("ExportNamedDeclaration", node =>
        Option.match(Option.fromNullishOr(node.source), {
          onNone: () => Effect.void,
          onSome: source => report(source, source.value),
        })),
      Visitor.on("ImportExpression", node => reportLiteral(node, node.source)),
      Visitor.on("TSImportType", node => report(node.source, node.source.value)),
      Visitor.on("TSExternalModuleReference", node => report(node.expression, node.expression.value)),
      Visitor.on("CallExpression", node =>
        node.callee.type === "Identifier" && node.callee.name === "require"
          ? Option.match(Array.head(node.arguments), {
            onNone: () => Effect.void,
            onSome: source => reportLiteral(node, source),
          })
          : Effect.void),
    );
  });

const boundaryRule = (definition: BoundaryRule) =>
  Rule.define({
    name: definition.name,
    meta: Rule.meta({ type: "problem", description: definition.description }),
    create: function*() {
      // Oxlint owns this synchronous entry; POSIX path normalization acquires no resource.
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The rule factory is the native lint host boundary.
      return yield* moduleVisitor(definition).pipe(Effect.provide(Path.layer));
    },
  });

export const contractIsolation = boundaryRule({
  name: "contract-isolation",
  description: "Contract schemas depend only on Effect and their own package.",
  violation: ({ file, source, target }) =>
    !within(file, "packages/contract/src") || source === "effect" || source.startsWith("effect/")
      || Option.exists(target, value => within(value, "packages/contract/src"))
      ? Option.none()
      : Option.some(`Contract cannot import '${source}'; only Effect and its own modules are allowed.`),
});

export const appIsolation = boundaryRule({
  name: "app-isolation",
  description: "Applications and packages cannot reach another application's source.",
  allSources: true,
  violation: ({ file, source, target }) => {
    const origin = app(file);
    const destination = Option.flatMap(target, app);
    return Option.isSome(destination)
        && (file.startsWith("packages/") || (Option.isSome(origin) && origin.value !== destination.value))
      ? Option.some(`'${source}' crosses an application boundary; depend on a package export.`)
      : Option.none();
  },
});

export const featureIsolation = boundaryRule({
  name: "feature-isolation",
  description: "A feature imports its own modules or global packages, never sibling features.",
  violation: ({ file, source, target }) => {
    const origin = feature(file);
    const destination = Option.flatMap(target, feature);
    const sameOwner = Option.exists(
      target,
      value => value.split("/").slice(0, 3).join("/") === file.split("/").slice(0, 3).join("/"),
    );
    return sameOwner && Option.isSome(origin) && Option.isSome(destination) && origin.value !== destination.value
      ? Option.some(`Feature '${origin.value}' cannot import sibling '${destination.value}' through '${source}'.`)
      : Option.none();
  },
});

export const signerIsolation = boundaryRule({
  name: "signer-isolation",
  description: "Signer authority excludes inference, agents and Floor application code.",
  violation: ({ file, source, target }) => {
    if (!within(file, "apps/signer")) return Option.none();
    const inference = /^(?:openai(?:\/|$)|@anthropic-ai\/|@yielded\/|@effect\/ai-|effect\/ai(?:\/|$))/.test(source);
    return inference || Option.exists(target, value => within(value, "apps/floor"))
      ? Option.some(`Signer cannot import agent or inference capability '${source}'.`)
      : Option.none();
  },
});

export const threeIsolation = boundaryRule({
  name: "three-isolation",
  description: "Three.js and its adapters stay in the web application, including test adapters.",
  allSources: true,
  violation: ({ file, source }) =>
    !within(file, "apps/web") && /^(?:three(?:\/|$)|three-mesh-bvh(?:\/|$)|three-edge-projection(?:\/|$))/.test(source)
      ? Option.some(`Three.js capability '${source}' belongs only in apps/web.`)
      : Option.none(),
});

export const legacyDependencies = boundaryRule({
  name: "legacy-dependencies",
  description: "Production uses the accepted runtime and chain service edges.",
  violation: ({ source }) =>
    /^(?:effect-cf|@solana\/web3\.js|@coral-xyz\/anchor|bn\.js|@meteora-ag\/dynamic-bonding-curve-sdk)(?:\/|$)/.test(
        source,
      )
      || source === "@whetstone-research/doppler-sdk"
      ? Option.some(`Production cannot import '${source}'; use the reviewed Alchemy or chain adapter.`)
      : Option.none(),
});

export const productionFixtures = boundaryRule({
  name: "production-fixtures",
  description: "Production excludes test exports, fixtures, recordings and the workbench.",
  violation: ({ source, target }) =>
    testingPath(source) || source.split("/").includes("workbench")
      || Option.exists(target, value => testingPath(value) || value.split("/").includes("workbench"))
      ? Option.some(`Production cannot import test or workbench material '${source}'.`)
      : Option.none(),
});

export const staticModules = Rule.define({
  name: "static-modules",
  meta: Rule.meta({ type: "problem", description: "Production dependencies must be statically checkable." }),
  create: function*() {
    const context = yield* RuleContext;
    const relative = context.filename.replaceAll("\\", "/").replace(context.cwd.replaceAll("\\", "/") + "/", "");
    if (!productionPath(relative)) return {};
    const check = (node: ESTree.Node, value: Option.Option<ESTree.Node>) =>
      Option.isSome(Option.flatMap(value, literal))
        ? Effect.void
        : context.report(
          Diagnostic.make({ node, message: "Use a literal dependency so authority boundaries can be checked." }),
        );
    return Visitor.merge(
      Visitor.on("ImportExpression", node => check(node, Option.some(node.source))),
      Visitor.on("CallExpression", node =>
        node.callee.type === "Identifier" && node.callee.name === "require"
          ? check(node, Array.head(node.arguments))
          : Effect.void),
    );
  },
});

// Collect path fragments before normalization so join('testing', file) is visible.
const pathFragments = (node: ESTree.Node): readonly string[] => {
  const value = literal(node);
  if (Option.isSome(value)) return [value.value];
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return [...pathFragments(node.left), ...pathFragments(node.right)];
  }
  if (node.type === "TemplateLiteral") return node.quasis.map(part => part.value.raw);
  if (node.type === "CallExpression" || node.type === "NewExpression") return node.arguments.flatMap(pathFragments);
  return [];
};
const staticPath = (node: ESTree.Node): boolean => {
  if (Option.isSome(literal(node))) return true;
  if (node.type === "BinaryExpression" && node.operator === "+") return staticPath(node.left) && staticPath(node.right);
  if (
    node.type === "CallExpression"
    && Option.exists(calledName(node.callee), name => name === "join" || name === "resolve")
  ) {
    return node.arguments.length > 0 && node.arguments.every(staticPath);
  }
  return false;
};
const calledName = (node: ESTree.Node): Option.Option<string> => {
  if (node.type === "Identifier") return Option.some(node.name);
  if (node.type === "MemberExpression") {
    if (!node.computed && node.property.type === "Identifier") return Option.some(node.property.name);
    return literal(node.property);
  }
  return Option.none();
};

export const dataReads = Rule.define({
  name: "data-reads",
  meta: Rule.meta({
    type: "problem",
    description: "File reads and copies cannot bypass the testing and workbench fences.",
  }),
  create: function*() {
    const context = yield* RuleContext;
    const relative = context.filename.replaceAll("\\", "/").replace(context.cwd.replaceAll("\\", "/") + "/", "");
    const production = productionPath(relative);
    return Visitor.on("CallExpression", node => {
      const name = calledName(node.callee);
      if (
        !Option.exists(
          name,
          value =>
            /^(?:file|readFile|readFileSync|readFileString|readTextFile|createReadStream|copyFile|copyFileSync|copy|cp|cpSync|glob)$/
              .test(value),
        )
      ) return Effect.void;
      const input = Array.head(node.arguments);
      const fragments = Option.match(input, { onNone: () => [], onSome: pathFragments });
      const joined = fragments.join("/").replaceAll("\\", "/");
      const forbidden = production && (testingPath(joined) || joined.split("/").includes("workbench"));
      if (forbidden) {
        return context.report(
          Diagnostic.make({
            node,
            message: "Production file reads and copies cannot consume testing or workbench data.",
          }),
        );
      }
      // Runtime file inputs belong in an explicit capability edge; opaque paths cannot prove a production-data boundary.
      if (production && !Option.exists(input, staticPath)) {
        return context.report(
          Diagnostic.make({ node, message: "A production file dependency must have a statically declared path." }),
        );
      }
      return Effect.void;
    });
  },
});

export const atlasLiterals = Rule.define({
  name: "atlas-literals",
  meta: Rule.meta({ type: "problem", description: "Production visual values come from the approved Atlas source." }),
  create: function*() {
    const context = yield* RuleContext;
    const file = context.filename.replaceAll("\\", "/").replace(context.cwd.replaceAll("\\", "/") + "/", "");
    if (!productionPath(file) || within(file, "packages/atlas/src")) return {};
    const check = (node: ESTree.Node, value: string) =>
      hasVisualLiteral(value)
        ? context.report(Diagnostic.make({ node, message: "Use approved Atlas tokens for colour and pixel values." }))
        : Effect.void;
    return Visitor.merge(
      Visitor.on("Literal", node =>
        Option.match(Schema.decodeUnknownOption(Schema.String)(node.value), {
          onNone: () => Effect.void,
          onSome: value => check(node, value),
        })),
      Visitor.on("TemplateElement", node => check(node, node.value.raw)),
    );
  },
});

export default Plugin.define({
  name: "floor",
  rules: {
    "contract-isolation": contractIsolation,
    "chain-neutral-schemas": chainNeutralSchemas,
    "app-isolation": appIsolation,
    "feature-isolation": featureIsolation,
    "signer-isolation": signerIsolation,
    "three-isolation": threeIsolation,
    "legacy-dependencies": legacyDependencies,
    "production-fixtures": productionFixtures,
    "static-modules": staticModules,
    "data-reads": dataReads,
    "atlas-literals": atlasLiterals,
  },
});
