import { Array, Effect, Option, Predicate } from "effect";
import { Diagnostic, type ESTree, Rule, RuleContext, Scope, Visitor } from "effect-oxlint";

const adapterPath = (file: string): boolean => /^packages\/chains\/src\/(?:solana|evm)\//.test(file);
const fieldName = (node: ESTree.Node): Option.Option<string> => {
  if (node.type === "Identifier") return Option.some(node.name);
  if (node.type === "Literal" && Predicate.isString(node.value)) return Option.some(node.value);
  return Option.none();
};
const chainName = (name: string): boolean => {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return /(?:^|_)(?:lamports?|wei|gwei|satoshis?)(?:_|$)/.test(words)
    || words === "block" || /(?:^|_)block_(?:number|height)(?:_|$)/.test(words);
};
const hexPattern = (value: string): boolean => /0(?:[xX]|\[xX\]|\[Xx\])/.test(value);
const schemaModule = (source: string): boolean => source === "effect/Schema";
const construction = (name: string): boolean =>
  name !== "isSchema" && name !== "isSchemaError"
  && /^(?:[A-Z]|is[A-Z]|makeFilter|optional|required|mutable|readonly|brand|suspend|check|refine|fieldsAssign|extendTo|from|to(?:Type|Encoded|Codec|TaggedUnion)|with(?:Decoding|Constructor))/
    .test(name);

interface Violation {
  readonly node: ESTree.Node;
  readonly detail: string;
}
const literalViolation = (node: ESTree.Node, value: string): readonly Violation[] => {
  if (hexPattern(value)) return [{ node, detail: "a chain-specific 0x pattern" }];
  if (chainName(value)) return [{ node, detail: "a chain-specific unit or bare block number" }];
  return [];
};
const inspectControlFlow = (
  node: ESTree.Node,
  visit: (child: ESTree.Node) => readonly Violation[],
): readonly Violation[] => {
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
    return Option.match(Option.fromNullishOr(node.body), { onNone: () => [], onSome: visit });
  }
  if (node.type === "BlockStatement") return node.body.flatMap(visit);
  if (node.type === "ReturnStatement") {
    return Option.match(Option.fromNullishOr(node.argument), { onNone: () => [], onSome: visit });
  }
  if (node.type === "LogicalExpression") return [...visit(node.left), ...visit(node.right)];
  if (node.type === "ConditionalExpression") {
    return [...visit(node.test), ...visit(node.consequent), ...visit(node.alternate)];
  }
  return [];
};
const inspectFields = (
  node: ESTree.ObjectExpression,
  visit: (child: ESTree.Node) => readonly Violation[],
): readonly Violation[] =>
  node.properties.flatMap(property => {
    if (property.type === "SpreadElement") return visit(property.argument);
    const own = Option.exists(fieldName(property.key), chainName)
      ? [{ node: property.key, detail: "a chain-specific unit or bare block number" }]
      : [];
    return [...own, ...visit(property.value)];
  });
const inspectCall = (
  node: ESTree.CallExpression | ESTree.NewExpression,
  visit: (child: ESTree.Node) => readonly Violation[],
): readonly Violation[] => {
  // Metadata prose and values passed to schema constructors are not schema
  // constraints. Decoders are excluded before reaching this traversal.
  if (
    node.callee.type === "MemberExpression"
    && Option.exists(fieldName(node.callee.property), name => name === "annotate" || name === "make")
  ) return visit(node.callee.object);
  const receiver = node.callee.type === "MemberExpression" ? visit(node.callee.object) : [];
  return [...receiver, ...node.arguments.flatMap(visit)];
};

export const chainNeutralSchemas = Rule.define({
  name: "chain-neutral-schemas",
  meta: Rule.meta({
    type: "problem",
    description: "Chain-specific Schema encodings belong only in chain adapters.",
  }),
  create: function*() {
    const context = yield* RuleContext;
    const file = context.filename.replaceAll("\\", "/").replace(context.cwd.replaceAll("\\", "/") + "/", "");
    if (adapterPath(file)) return {};
    const reported = new Set<ESTree.Node>();
    const binding = (node: ESTree.Node) =>
      node.type === "Identifier"
        ? Option.flatMap(Scope.findVariableUp(context.sourceCode.getScope(node), node.name), value =>
          Array.head(value.defs))
        : Option.none();
    const initializer = (node: ESTree.Node): Option.Option<ESTree.Node> =>
      Option.flatMap(
        binding(node),
        definition =>
          definition.type === "Variable" && definition.node.type === "VariableDeclarator"
            ? Option.fromNullishOr(definition.node.init)
            : Option.none(),
      );
    const imported = (node: ESTree.Node): Option.Option<{ readonly source: string; readonly name: string }> =>
      Option.flatMap(binding(node), definition => {
        if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
          return Option.none();
        }
        const source = definition.parent.source.value;
        if (definition.node.type === "ImportNamespaceSpecifier") {
          return Option.some({ source, name: "*" });
        }
        if (definition.node.type === "ImportSpecifier") {
          return Option.map(
            fieldName(definition.node.imported),
            name => ({ source, name }),
          );
        }
        return Option.none();
      });
    const namespace = (node: ESTree.Node, seen: ReadonlySet<ESTree.Node>): boolean => {
      if (seen.has(node)) return false;
      const next = new Set([...seen, node]);
      const origin = imported(node);
      if (
        Option.exists(
          origin,
          value =>
            (value.source === "effect" && value.name === "Schema")
            || (schemaModule(value.source) && value.name === "*"),
        )
      ) return true;
      if (node.type === "MemberExpression" && Option.exists(fieldName(node.property), name => name === "Schema")) {
        return Option.exists(imported(node.object), value => value.source === "effect" && value.name === "*");
      }
      return Option.exists(initializer(node), value => namespace(value, next));
    };
    const operation = (node: ESTree.Node, seen: ReadonlySet<ESTree.Node> = new Set()): Option.Option<string> => {
      if (seen.has(node)) return Option.none();
      const next = new Set([...seen, node]);
      if (node.type === "MemberExpression") {
        if (namespace(node.object, next)) return fieldName(node.property);
        return operation(node.object, next);
      }
      if (node.type === "CallExpression") return operation(node.callee, next);
      if (node.type === "Identifier") {
        const origin = Option.filter(imported(node), value => schemaModule(value.source) && value.name !== "*");
        if (Option.isSome(origin)) return Option.some(origin.value.name);
        return Option.flatMap(initializer(node), value => operation(value, next));
      }
      return Option.none();
    };
    const isSchema = (node: ESTree.Node): boolean => Option.exists(operation(node), construction);
    // Follow local constant bindings, including extracted fields and patterns. Scope
    // resolution keeps a shadowed `Schema` or an ordinary transaction fixture out.
    const inspect = (node: ESTree.Node, seen: ReadonlySet<ESTree.Node> = new Set()): readonly Violation[] => {
      if (seen.has(node)) return [];
      const next = new Set([...seen, node]);
      const visit = (child: ESTree.Node) => inspect(child, next);
      if (node.type === "Identifier") return Option.match(initializer(node), { onNone: () => [], onSome: visit });
      if (node.type === "Literal") {
        const value = "regex" in node ? node.regex.pattern : Predicate.isString(node.value) ? node.value : "";
        return literalViolation(node, value);
      }
      if (node.type === "TemplateLiteral") {
        return [
          ...node.quasis.flatMap(part => literalViolation(part, part.value.raw)),
          ...node.expressions.flatMap(visit),
        ];
      }
      if (node.type === "ObjectExpression") return inspectFields(node, visit);
      if (node.type === "ArrayExpression") {
        return node.elements.flatMap(value =>
          Option.match(Option.fromNullishOr(value), { onNone: () => [], onSome: visit })
        );
      }
      if (node.type === "SpreadElement") return visit(node.argument);
      if (node.type === "CallExpression" || node.type === "NewExpression") return inspectCall(node, visit);
      if (node.type === "BinaryExpression" && node.operator === "+") return [...visit(node.left), ...visit(node.right)];
      if (
        node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression"
        || node.type === "ParenthesizedExpression"
      ) return visit(node.expression);
      return inspectControlFlow(node, visit);
    };
    const report = Effect.fnUntraced(function*(violations: readonly Violation[]) {
      for (const violation of violations) {
        if (reported.has(violation.node)) continue;
        reported.add(violation.node);
        yield* context.report(Diagnostic.make({
          node: violation.node,
          message:
            `Schema contains ${violation.detail}; use chain-neutral references, checkpoints and amounts, or move the encoding to a chain adapter.`,
        }));
      }
    });
    return Visitor.merge(
      Visitor.on("CallExpression", node => isSchema(node) ? report(inspect(node)) : Effect.void),
      Visitor.on("VariableDeclarator", node => {
        if (!Option.exists(Option.fromNullishOr(node.init), isSchema)) return Effect.void;
        return Option.exists(fieldName(node.id), chainName)
          ? report([{ node: node.id, detail: "a chain-specific unit or bare block number" }])
          : Effect.void;
      }),
    );
  },
});
