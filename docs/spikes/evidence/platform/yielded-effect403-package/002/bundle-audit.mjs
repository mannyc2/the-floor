import { readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { resolve, relative, dirname, join, sep } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const bundle = resolve(process.argv[2]);
const transpiler = new Bun.Transpiler({ loader: "js" });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rel = (path) => relative(root, path);
const file = (path) => {
  const bytes = readFileSync(path);
  return { path: rel(path), bytes: bytes.length, sha256: sha(bytes) };
};
const revision = (directory) => {
  const result = Bun.spawnSync(["git", "-C", directory, "rev-parse", "HEAD"]);
  if (result.exitCode !== 0) throw new Error("Cannot read source revision");
  return result.stdout.toString().trim();
};
const clone = join(root, "work/yielded-pack/source");
const evidence = join(root, "docs/spikes/evidence/platform/yielded-effect403-package/002");
const manifest = JSON.parse(readFileSync(join(evidence, "executed-source-manifest.json"), "utf8"));
const queue = [join(bundle, "entry.js")];
const seen = new Set();
const files = [];
const missing = [];
const missingMaps = [];
const sources = [];
const unresolvedSources = [];
const packages = new Map();
const external = new Set();
const fixtures = [];
const markerMatches = [];
const packageFor = (path) => {
  let directory = dirname(realpathSync(path));
  while (directory !== dirname(directory)) {
    const path = join(directory, "package.json");
    if (existsSync(path)) {
      const content = JSON.parse(readFileSync(path, "utf8"));
      if (content.name && content.version) return { ...content, manifest: path };
    }
    directory = dirname(directory);
  }
};

// Alchemy retains stale chunks. Only the current entry's parsed import graph counts.
while (queue.length > 0) {
  const path = queue.pop();
  if (seen.has(path)) continue;
  seen.add(path);
  if (!existsSync(path)) {
    missing.push(rel(path));
    continue;
  }
  const bytes = readFileSync(path);
  files.push(file(path));
  if (bytes.includes(Buffer.from("effect-cf"))) markerMatches.push(rel(path));
  for (const item of transpiler.scan(bytes).imports) {
    if (item.path.startsWith(".")) {
      const target = resolve(dirname(path), item.path);
      if (target.startsWith(bundle + sep)) queue.push(target);
      else missing.push(rel(target));
    } else external.add(item.path);
  }
  const mapPath = path + ".map";
  if (!existsSync(mapPath)) {
    missingMaps.push(rel(path));
    continue;
  }
  files.push(file(mapPath));
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  for (const [index, name] of (map.sources ?? []).entries()) {
    const sourcePath = resolve(dirname(mapPath), map.sourceRoot ?? "", name);
    sources.push({ map: rel(mapPath), source: name });
    if (!existsSync(sourcePath)) {
      unresolvedSources.push({ map: rel(mapPath), source: name });
      continue;
    }
    const pkg = packageFor(sourcePath);
    if (pkg) {
      const key = pkg.name + "@" + pkg.version;
      const item = packages.get(key) ?? {
        name: pkg.name,
        version: pkg.version,
        manifest: file(pkg.manifest),
        source_entries: 0,
      };
      item.source_entries++;
      packages.set(key, item);
    }
    const replayPart = "/apps/floor/spikes/platform/alchemy-agent/";
    if (sourcePath.includes(replayPart) && !sourcePath.includes("/node_modules/")) {
      const suffix = sourcePath.split(replayPart)[1];
      const authored = "apps/floor/spikes/platform/alchemy-agent/" + suffix;
      const archived = manifest.files.find((entry) => entry.path === authored);
      const embedded = map.sourcesContent?.[index];
      const embeddedHash = typeof embedded === "string" ? sha(Buffer.from(embedded)) : null;
      fixtures.push({
        source: authored,
        mapped_source: name,
        bytes: file(sourcePath).bytes,
        sha256: file(sourcePath).sha256,
        sources_content_sha256: embeddedHash,
        matches_authored: file(join(root, authored)).sha256 === embeddedHash,
        matches_mapped_source: file(sourcePath).sha256 === embeddedHash,
        matches_archived_manifest: archived?.sha256 === embeddedHash,
      });
    }
  }
}
const packageList = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
const effectCf = {
  packages: packageList.filter((item) => item.name === "effect-cf"),
  mapped_source_paths: sources.filter((item) => /effect-cf/.test(item.source)),
  external_imports: [...external].filter((name) => /effect-cf/.test(name)),
  emitted_js_marker_matches: markerMatches,
};
const audit = {
  captured_at_utc: new Date().toISOString(),
  scope: "Current packed Yielded Effect 4.0.3 native agent plus DO/D1 storage build only. This is not a retroactive claim about historical source-based builds.",
  source_identity: {
    floor_revision_at_audit: revision(root),
    upstream_revision: revision(clone),
    source_archive: file(join(evidence, "executed-source.tar.gz")),
    source_manifest: file(join(evidence, "executed-source-manifest.json")),
    consumer_bun_lock: file(join(root, "apps/floor/spikes/platform/alchemy-agent/bun.lock")),
    packed_provenance: file(join(root, "vendor/yielded/0adbcff-effect-4.0.3/provenance.json")),
    compatibility_patch: file(join(root, "vendor/yielded/0adbcff-effect-4.0.3/effect-4.0.3-crypto.patch")),
    upstream_patch: file(join(clone, "patches/alchemy@2.0.0-beta.80.patch")),
    mapped_fixture_sources: fixtures,
  },
  auditor: { bun_version: Bun.version, script: file(join(evidence, "bundle-audit.mjs")) },
  entry: rel(join(bundle, "entry.js")),
  method: "Bun.Transpiler parses static imports/exports and literal dynamic imports. Traverse only reachable local chunks, inspect only their maps, and resolve package versions from each mapped source's nearest package manifest, including upstream workspace packages. Hash all visited JS/maps. Compare embedded fixture sources with authored bytes and the immutable as-run manifest.",
  limitations: "Computed nonliteral imports are not resolved. Source maps describe bundled source provenance, not executed branches. The small rolldown helper has no map; emitted JS marker scanning also covers that helper. External Node imports remain present, so this is not bare-runtime evidence. No old agent-only bundle is audited.",
  reachable_js_files: files.filter((item) => item.path.endsWith(".js")).length,
  source_map_files: files.filter((item) => item.path.endsWith(".map")).length,
  source_entries: sources.length,
  mapped_source_paths_sha256: sha(JSON.stringify(sources)),
  packages: packageList,
  effect_cf: effectCf,
  missing_relative_imports: missing,
  js_without_maps: missingMaps,
  unresolved_mapped_sources: unresolvedSources,
  external_imports: [...external].sort(),
  excluded_cached_js_files: readdirSync(bundle).filter((name) => name.endsWith(".js") && !seen.has(join(bundle, name))).sort(),
  files,
};
console.log(JSON.stringify(audit, null, 2));
