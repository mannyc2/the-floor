import { resolve, relative, dirname } from "node:path";
import { Result, Schema } from "effect";
import { moduleImports } from "../../scripts/bundle-budget/imports";
import { generatedModuleSha256 } from "../../scripts/bundle-budget/generated";

const root = process.cwd();
const directory = resolve(root, "work/hosted-readiness/run-002");
const extracted = resolve(directory, "bundle-inspection");
const sources = resolve(directory, "source-inspection");
for (const target of [extracted, sources]) await Bun.$`mkdir -p ${target}`.quiet();
for (const [archive, target] of [["deployed-build-directories.tar.gz", extracted], ["executed-source.tar.gz", sources]]) {
  if (archive === undefined || target === undefined) throw new Error("Missing archive tuple");
  const child = Bun.spawn(["tar", "-xzf", resolve(directory, archive), "-C", target], { env: { ...process.env, LC_ALL: "C" }, stdout: "ignore", stderr: "pipe" });
  if (await child.exited !== 0) throw new Error("Source archive could not be extracted");
}
const MapSchema = Schema.Struct({ sources: Schema.Array(Schema.String), sourcesContent: Schema.Array(Schema.NullOr(Schema.String)) });
const decodeMap = Schema.decodeUnknownSync(Schema.fromJsonString(MapSchema));
const hash = (data: string | ArrayBuffer) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const audit = async (worker: string, entry: string) => {
  const target = `.alchemy/bundles/${worker}`;
  const seen = new Set<string>();
  const pending = [entry];
  const modules: { file: string; bytes: number; sha256: string; imports: readonly string[] }[] = [];
  const sourcePaths = new Set<string>();
  const ownSourceMatches: { file: string; sha256: string; archiveMatch: boolean }[] = [];
  const externals = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const absolute = resolve(extracted, target, file);
    if (!absolute.startsWith(resolve(extracted, target) + "/")) throw new Error("Escaping bundle import");
    const code = await Bun.file(absolute).text();
    const imports = moduleImports(code, file);
    if (Result.isFailure(imports)) throw new Error(imports.failure.message);
    modules.push({ file, bytes: Buffer.byteLength(code), sha256: hash(code), imports: imports.success });
    for (const dependency of imports.success) {
      if (dependency.startsWith(".")) pending.push(relative(resolve(extracted, target), resolve(dirname(absolute), dependency)));
      else if (dependency.startsWith("node:") || dependency === "cloudflare:workers") externals.add(dependency);
      else throw new Error(`Unexpected external ${dependency}`);
    }
    if (!(await Bun.file(`${absolute}.map`).exists())) {
      if (!generatedModuleSha256.has(hash(code))) throw new Error(`Missing map for ${file}`);
      continue;
    }
    const map = decodeMap(await Bun.file(`${absolute}.map`).text());
    for (const [index, source] of map.sources.entries()) {
      const normalized = relative(root, resolve(root, target, source));
      sourcePaths.add(normalized);
      if (/(?:^|\/)effect-cf(?:@[^/]+)?\//.test(normalized)) throw new Error("Legacy effect-cf source is reachable");
      if (!normalized.startsWith("apps/floor/")) continue;
      const embedded = map.sourcesContent[index];
      if (typeof embedded !== "string") throw new Error(`Missing original source: ${normalized}`);
      const archived = await Bun.file(resolve(sources, normalized)).text();
      const archiveMatch = hash(embedded) === hash(archived);
      ownSourceMatches.push({ file: normalized, sha256: hash(embedded), archiveMatch });
      if (!archiveMatch) throw new Error(`Source archive mismatch: ${normalized}`);
    }
  }
  return { worker, entry, modules, mappedSourceCount: sourcePaths.size, sourcePaths: [...sourcePaths].sort(), ownSourceMatches, externals: [...externals].sort(), effectCfReachable: false, expectedTestModel: worker === "FloorLocalAgent" ? "@yielded/agent-testing (testing-only fixture)" : "none" };
};
const audits = await Promise.all([audit("FloorLocalAgent", "index.js"), audit("FloorHostedCrypto", "hosted-crypto.js")]);
await Bun.write(resolve(directory, "bundle-audit.json"), JSON.stringify({ recordedAt: new Date().toISOString(), scope: "Archived emitted graph and source-map evidence; no claim of a captured Cloudflare version ID", audits }, null, 2) + "\n");
console.log(audits.map(({ worker, modules, mappedSourceCount, ownSourceMatches }) => ({ worker, modules: modules.length, mappedSourceCount, ownSourceMatches: ownSourceMatches.length })));
