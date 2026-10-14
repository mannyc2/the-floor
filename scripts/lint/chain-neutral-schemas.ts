import { Array, Effect, Option, Predicate } from "effect";
import { Diagnostic, type ESTree, Rule, RuleContext, Scope, Visitor } from "effect-oxlint";

const adapterPath = (file: string): boolean => /^packages\/chains\/src\/(?:solana|evm)\//.test(file);
const fieldName = (node: ESTree.Node): Option.Option<string> => {
  if (node.type === "Identifier") return Option.some(node.name);
  if (node.type === "Literal" && Predicate.isString(node.value)) return Option.some(node.value);
  return Option.none();
};
const nameWords = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const chainUnit = (name: string): boolean =>
  /(?:^|_)(?:lamports?|wei|gwei|satoshis?|sats?)(?:_|$)/.test(nameWords(name));
const blockNumberName = (name: string): boolean => /(?:^|_)block_?(?:number|num|height)(?:_|$)/.test(nameWords(name));
// A hexadecimal prefix is a token boundary. Substrings in a leverage label or
// screen resolution do not establish a chain encoding.
const hexPattern = (value: string): boolean => /(?:^|[^a-zA-Z0-9]|\\b)0(?:[xX]|\[xX\]|\[Xx\])/.test(value);
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
  if (chainUnit(value)) return [{ node, detail: "a chain-specific unit" }];
  return [];
};
const inspectControlFlow = (
  node: ESTree.Node,
  visit: (child: ESTree.Node) => readonly Violation[],
): readonly Violation[] => {
  if (
    node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration"
  ) {
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
  if (node.type === "IfStatement") {
    return [
      ...visit(node.test),
      ...visit(node.consequent),
      ...Option.match(Option.fromNullishOr(node.alternate), { onNone: () => [], onSome: visit }),
    ];
  }
  if (node.type === "ExpressionStatement") return visit(node.expression);
  if (node.type === "UnaryExpression") return visit(node.argument);
  if (node.type === "VariableDeclaration") return node.declarations.flatMap(visit);
  if (node.type === "VariableDeclarator") {
    return Option.match(Option.fromNullishOr(node.init), { onNone: () => [], onSome: visit });
  }
  return [];
};
const inspectFields = (
  node: ESTree.ObjectExpression,
  visit: (child: ESTree.Node) => readonly Violation[],
  fieldViolation: (key: ESTree.Node, value: ESTree.Node) => readonly Violation[],
): readonly Violation[] =>
  node.properties.flatMap(property => {
    if (property.type === "SpreadElement") return visit(property.argument);
    return [...fieldViolation(property.key, property.value), ...visit(property.value)];
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
        definition => {
          if (definition.type === "Variable" && definition.node.type === "VariableDeclarator") {
            return Option.fromNullishOr(definition.node.init);
          }
          if (definition.type === "FunctionName" && definition.node.type === "FunctionDeclaration") {
            return Option.some(
              definition.node,
            );
          }
          return Option.none();
        },
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
        if (Option.exists(fieldName(node.property), name => name === "make" || name === "makeUnsafe")) {
          return Option
            .none();
        }
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
    const numericSchema = (node: ESTree.Node, seen: ReadonlySet<ESTree.Node> = new Set()): boolean => {
      if (seen.has(node)) return false;
      const next = new Set([...seen, node]);
      const name = operation(node);
      if (Option.exists(name, value => /^(?:Int|Finite|Number|BigInt)/.test(value))) return true;
      if (node.type === "Identifier") return Option.exists(initializer(node), value => numericSchema(value, next));
      if (node.type === "ArrayExpression") {
        return node.elements.some(value =>
          Option.exists(Option.fromNullishOr(value), child => numericSchema(child, next))
        );
      }
      return node.type === "CallExpression"
        && Option.exists(
          name,
          value => /^(?:optional|required|OptionFrom|NullOr|UndefinedOr|Union|brand|toType|toEncoded)/.test(value),
        )
        && node.arguments.some(value => numericSchema(value, next));
    };
    const fieldViolation = (key: ESTree.Node, value: ESTree.Node): readonly Violation[] => {
      const name = fieldName(key);
      const forbidden = Option.exists(name, field =>
        chainUnit(field) || blockNumberName(field)
        || (/^(?:block|slot)$/.test(nameWords(field)) && numericSchema(value)));
      return forbidden ? [{ node: key, detail: "a chain-specific unit or bare block number" }] : [];
    };
    const resolvedValue = (
      node: ESTree.Node,
      seen: ReadonlySet<ESTree.Node> = new Set(),
    ): Option.Option<ESTree.Node> => {
      if (seen.has(node)) return Option.none();
      const next = new Set([...seen, node]);
      if (node.type === "Identifier") return Option.flatMap(initializer(node), value => resolvedValue(value, next));
      if (node.type !== "MemberExpression") return Option.some(node);
      return Option.flatMap(resolvedValue(node.object, next), object => {
        if (object.type !== "ObjectExpression") return Option.none();
        const name = node.computed
          ? Option.flatMap(resolvedValue(node.property, next), fieldName)
          : fieldName(node.property);
        return Option.flatMap(
          Array.findLast(object.properties, property =>
            property.type === "Property"
            && Option.exists(fieldName(property.key), value => Option.contains(name, value))),
          property => property.type === "Property" ? resolvedValue(property.value, next) : Option.none(),
        );
      });
    };
    // Follow local constant bindings, including extracted fields and patterns. Scope
    // resolution keeps a shadowed `Schema` or an ordinary transaction fixture out.
    const inspect = (node: ESTree.Node, seen: ReadonlySet<ESTree.Node> = new Set()): readonly Violation[] => {
      if (seen.has(node)) return [];
      const next = new Set([...seen, node]);
      const visit = (child: ESTree.Node) => inspect(child, next);
      if (node.type === "Identifier" || node.type === "MemberExpression") {
        return Option.match(resolvedValue(node), { onNone: () => [], onSome: visit });
      }
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
      if (node.type === "ObjectExpression") return inspectFields(node, visit, fieldViolation);
      if (node.type === "ArrayExpression") {
        return node.elements.flatMap(value =>
          Option.match(Option.fromNullishOr(value), { onNone: () => [], onSome: visit })
        );
      }
      if (node.type === "SpreadElement") return visit(node.argument);
      if (node.type === "CallExpression" || node.type === "NewExpression") return inspectCall(node, visit);
      if (node.type === "BinaryExpression") return [...visit(node.left), ...visit(node.right)];
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
        return Option.match(Option.filter(Option.fromNullishOr(node.init), isSchema), {
          onNone: () => Effect.void,
          onSome: value => report(fieldViolation(node.id, value)),
        });
      }),
    );
  },
});
