import { Effect, Option, Path, Schema } from "effect";
import { Diagnostic, type ESTree, Plugin, Rule, RuleContext, Visitor } from "effect-oxlint";
import { hasVisualLiteral } from "./visual-values";

interface Boundary {
  readonly file: string;
  readonly source: string;
  readonly target: Option.Option<string>;
}

interface BoundaryRule {
  readonly name: string;
  readonly description: string;
  readonly allSources?: boolean;
  readonly violation: (boundary: Boundary) => Option.Option<string>;
}

const within = (file: string, directory: string) => file === directory || file.startsWith(`${directory}/`);
// Imports often omit the source extension, so testing ownership is determined
// before module resolution and also checked again on emitted source-map paths.
const testingPath = (file: string): boolean =>
  file.replaceAll("\\", "/").split("/").some(part =>
    part.endsWith("-testing") || ["test", "testing", "__tests__", "_fixtures", "fixtures", "recordings"].includes(part)
  ) || /\.(test|spec)(?:\.[cm]?[jt]sx?)?$/.test(file);

const productionPath = (file: string) => /^(apps|packages)\/[^/]+\/src\//.test(file) && !testingPath(file);
const app = (file: string) => Option.fromUndefinedOr(/^apps\/([^/]+)\//.exec(file)?.[1]);
const feature = (file: string) =>
  Option.filter(
    Option.fromUndefinedOr(/^(?:apps|packages)\/[^/]+\/src\/([^/]+)\//.exec(file)?.[1]),
    name => !name.startsWith("_") && name !== "testing",
  );
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
      Option.match(rule.violation({ file, source, target: target(source) }), {
        onNone: () => Effect.void,
        onSome: message => context.report(Diagnostic.make({ node, message })),
      });
    // Native import restrictions inspect string literals, but not templates, require calls or type queries.
    const inspectable = (node: ESTree.Node) =>
      rule.allSources === true
        ? context.report(Diagnostic.make({
          node,
          message: "Use a static import or a string-literal import() so module boundaries remain inspectable.",
        }))
        : Effect.void;
    return Visitor.merge(
      Visitor.on("ImportDeclaration", node => report(node.source, node.source.value)),
      Visitor.on("ExportAllDeclaration", node => report(node.source, node.source.value)),
      Visitor.on("ExportNamedDeclaration", node =>
        Option.match(Option.fromNullishOr(node.source), {
          onNone: () => Effect.void,
          onSome: source => report(source, source.value),
        })),
      Visitor.on("ImportExpression", node =>
        node.source.type === "Literal"
          ? Option.match(Schema.decodeUnknownOption(Schema.String)(node.source.value), {
            onNone: () => inspectable(node),
            onSome: source => report(node, source),
          })
          : inspectable(node)),
      Visitor.on("TSImportType", inspectable),
      Visitor.on("TSExternalModuleReference", node => report(node.expression, node.expression.value)),
      Visitor.on("CallExpression", node =>
        node.callee.type === "Identifier" && node.callee.name === "require"
          ? inspectable(node)
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
    "app-isolation": appIsolation,
    "feature-isolation": featureIsolation,
    "atlas-literals": atlasLiterals,
  },
});
