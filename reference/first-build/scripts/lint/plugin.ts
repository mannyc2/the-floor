import { Array, Effect, Option, Path, Schema } from "effect";
import { Diagnostic, type ESTree, Plugin, Rule as CustomRule, RuleContext, Visitor } from "effect-oxlint";

interface ModuleBoundary {
  readonly filename: string;
  readonly source: string;
  readonly target: Option.Option<string>;
  readonly relativeTarget: Option.Option<string>;
  readonly packageRoot: (name: string) => string;
  readonly frontendFeature: (filename: string) => Option.Option<string>;
}
interface BoundaryRule {
  readonly name: string;
  readonly description: string;
  readonly violation: (boundary: ModuleBoundary) => Option.Option<string>;
}
const fixturePath = (filename: string) =>
  filename.split("/").some(part => ["test", "testing", "__tests__", "_fixtures"].includes(part))
  || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename);
const within = (filename: string, directory: string) => filename === directory || filename.startsWith(`${directory}/`);
const productionSource = (filename: string) => {
  const sourcePath = filename.slice(filename.lastIndexOf("/packages/") + 1);
  return /^packages\/[^/]+\/src\//.test(sourcePath) && !fixturePath(sourcePath);
};
const literalModule = (node: ESTree.Node): Option.Option<string> => {
  if (node.type === "Literal") return Schema.decodeUnknownOption(Schema.String)(node.value);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return Option.flatMap(Array.head(node.quasis), item => Option.fromNullishOr(item.value.cooked));
  }
  return Option.none();
};
const makeVisitor = (rule: BoundaryRule) =>
  Effect.gen(function*() {
    const context = yield* RuleContext;
    const path = yield* Path.Path;
    const filename = path.resolve(context.cwd, context.filename.replaceAll("\\", "/"));
    if (!productionSource(filename)) return {};
    const packageRoot = (name: string) => path.join(context.cwd, "packages", name, "src");
    const frontendRoot = packageRoot("frontend");
    const resolveModule = (source: string): Option.Option<string> => {
      if (source.startsWith(".")) return Option.some(path.resolve(path.dirname(filename), source));
      if (path.isAbsolute(source)) return Option.some(path.normalize(source));
      if (source.startsWith("@/")) return Option.some(path.join(frontendRoot, source.slice(2)));
      if (source.startsWith("@frontend/")) {
        return Option.some(path.join(frontendRoot, source.slice("@frontend/".length)));
      }
      if (source.startsWith("@floor/")) {
        const [domain, ...rest] = source.slice("@floor/".length).split("/");
        return Option.map(Option.fromUndefinedOr(domain), name => path.join(packageRoot(name), ...rest));
      }
      return Option.none();
    };
    const frontendFeature = (file: string) => {
      if (!within(file, frontendRoot)) return Option.none<string>();
      const segments = path.relative(frontendRoot, file).split("/");
      return Option.filter(Array.head(segments), first => segments.length > 1 && !first.startsWith("_"));
    };
    const report = (node: ESTree.Node, source: string) =>
      Option.match(
        rule.violation({
          filename,
          source,
          target: resolveModule(source),
          relativeTarget: Option.map(resolveModule(source), target => path.relative(context.cwd, target)),
          packageRoot,
          frontendFeature,
        }),
        {
          onNone: () => Effect.void,
          onSome: message => context.report(Diagnostic.make({ node, message })),
        },
      );
    const reportStatic = (node: ESTree.Node, source: ESTree.Node) =>
      Option.match(literalModule(source), { onNone: () => Effect.void, onSome: name => report(node, name) });
    return Visitor.merge(
      Visitor.on("ImportDeclaration", node => report(node.source, node.source.value)),
      Visitor.on("ExportAllDeclaration", node => report(node.source, node.source.value)),
      Visitor.on("ExportNamedDeclaration", node =>
        Option.match(Option.fromNullishOr(node.source), {
          onNone: () => Effect.void,
          onSome: source => report(source, source.value),
        })),
      Visitor.on("ImportExpression", node => reportStatic(node, node.source)),
      Visitor.on("TSImportType", node => report(node.source, node.source.value)),
      Visitor.on("TSExternalModuleReference", node => report(node.expression, node.expression.value)),
      Visitor.on("CallExpression", node =>
        node.callee.type === "Identifier" && node.callee.name === "require"
          ? Option.match(Array.head(node.arguments), {
            onNone: () => Effect.void,
            onSome: source => reportStatic(node, source),
          })
          : Effect.void),
    );
  });
const boundaryRule = (definition: BoundaryRule) =>
  CustomRule.define({
    name: definition.name,
    meta: CustomRule.meta({ type: "problem", description: definition.description }),
    create: function*() {
      // Oxlint invokes each rule factory as a synchronous runtime entry point; the native POSIX Path layer owns no resources.
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Each rule factory is the synchronous Oxlint host entry point; Path has no scoped resources.
      return yield* makeVisitor(definition).pipe(Effect.provide(Path.layer));
    },
  });
export const contractIsolation = boundaryRule({
  name: "contract-isolation",
  description: "The canonical contract depends only on Effect and its own modules.",
  violation: boundary => {
    const ownRoot = boundary.packageRoot("contract");
    if (!within(boundary.filename, ownRoot) || boundary.source === "effect" || boundary.source.startsWith("effect/")) {
      return Option.none();
    }
    if (Option.exists(boundary.target, target => within(target, ownRoot))) return Option.none();
    return Option.some(
      `The contract may import only Effect or its own modules; '${boundary.source}' crosses that boundary.`,
    );
  },
});
export const signingIsolation = boundaryRule({
  name: "signing-isolation",
  description: "Signing authority cannot depend on agent or inference runtimes.",
  violation: boundary => {
    if (!within(boundary.filename, boundary.packageRoot("signing"))) return Option.none();
    const inference = boundary.source === "openai" || boundary.source.startsWith("openai/")
      || boundary.source.startsWith("@anthropic-ai/") || boundary.source.startsWith("@yielded/")
      || boundary.source.startsWith("@effect/ai-") || boundary.source === "effect/ai"
      || boundary.source.startsWith("effect/ai/");
    const agentRuntime = Option.exists(boundary.target, target => within(target, boundary.packageRoot("agents")));
    return inference || agentRuntime
      ? Option.some(`Signing cannot import agent or inference capability '${boundary.source}'.`)
      : Option.none();
  },
});
export const productionFixtures = boundaryRule({
  name: "production-fixtures",
  description: "Production code cannot import tests, fixtures or recordings.",
  violation: boundary =>
    fixturePath(boundary.source) || Option.exists(boundary.relativeTarget, fixturePath)
      ? Option.some(`Production code cannot import test material '${boundary.source}'.`)
      : Option.none(),
});
export const frontendFeatureIsolation = boundaryRule({
  name: "frontend-feature-isolation",
  description: "Frontend features depend on shared modules and their own feature, never a sibling feature.",
  violation: boundary => {
    const sourceFeature = boundary.frontendFeature(boundary.filename);
    const targetFeature = Option.flatMap(boundary.target, boundary.frontendFeature);
    return Option.isSome(sourceFeature) && Option.isSome(targetFeature) && sourceFeature.value !== targetFeature.value
      ? Option.some(
        `Feature '${sourceFeature.value}' cannot import sibling feature '${targetFeature.value}'; move the shared capability to a global module.`,
      )
      : Option.none();
  },
});
export const staticModuleDependencies = CustomRule.define({
  name: "static-module-dependencies",
  meta: CustomRule.meta({
    type: "problem",
    description:
      "Production module dependencies must be statically identifiable so authority boundaries can be checked.",
  }),
  create: function*() {
    const context = yield* RuleContext;
    if (!productionSource(`/${context.filename.replaceAll("\\", "/")}`)) return {};
    const check = (node: ESTree.Node, source: Option.Option<ESTree.Node>) =>
      Option.isSome(Option.flatMap(source, literalModule))
        ? Effect.void
        : context.report(
          Diagnostic.make({
            node,
            message: "Use a literal module specifier so production dependency boundaries can be verified.",
          }),
        );
    return Visitor.merge(
      Visitor.on("ImportExpression", node => check(node, Option.some(node.source))),
      Visitor.on(
        "CallExpression",
        node =>
          node.callee.type === "Identifier" && node.callee.name === "require"
            ? check(node, Array.head(node.arguments))
            : Effect.void,
      ),
    );
  },
});
export default Plugin.define({
  name: "floor",
  rules: {
    "contract-isolation": contractIsolation,
    "signing-isolation": signingIsolation,
    "production-fixtures": productionFixtures,
    "frontend-feature-isolation": frontendFeatureIsolation,
    "static-module-dependencies": staticModuleDependencies,
  },
});
