import { Array, Option, Result, Schema } from "effect";
import { parseAst } from "rolldown/parseAst";
import { type ESTree, Visitor } from "rolldown/utils";
import { BundleBudgetError } from "./model";

const dependencies = (program: ReturnType<typeof parseAst>, file: string) => {
  const imports: string[] = [];
  let computed = false;
  const collect = (node: ESTree.Node) => {
    const path = node.type === "Literal"
      ? Schema.decodeUnknownOption(Schema.String)(node.value)
      : node.type === "TemplateLiteral" && node.expressions.length === 0
      ? Option.flatMap(Array.head(node.quasis), quasi => Option.fromNullishOr(quasi.value.cooked))
      : Option.none();
    Option.match(path, {
      onNone: () => {
        computed = true;
      },
      onSome: value => {
        imports.push(value);
      },
    });
  };
  new Visitor({
    ImportDeclaration: node => collect(node.source),
    ExportAllDeclaration: node => collect(node.source),
    ExportNamedDeclaration: node => {
      Option.map(Option.fromNullishOr(node.source), collect);
    },
    ImportExpression: node => collect(node.source),
    CallExpression: node => {
      if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
      Option.match(Array.head(node.arguments), {
        onNone: () => {
          computed = true;
        },
        onSome: collect,
      });
    },
  }).visit(program);
  return computed
    ? Result.fail(new BundleBudgetError({ reason: "InvalidModule", detail: `Computed module dependency in ${file}` }))
    : Result.succeed(imports);
};

// The bundler's import scanner silently omits computed imports. Parse the full AST
// so an uninspectable dependency cannot be mistaken for an empty dependency list.
export const moduleImports = (code: string, file: string) =>
  Result.try({
    try: () => parseAst(code, {}, file),
    catch: cause => new BundleBudgetError({ reason: "InvalidModule", detail: file, cause }),
  }).pipe(Result.flatMap(program => dependencies(program, file)));
