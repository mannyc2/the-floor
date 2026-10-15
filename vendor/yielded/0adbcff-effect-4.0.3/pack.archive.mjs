import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This mirrors the upstream release manifest conversion. A separately audited
// patch adapts four UUID calls to Effect 4.0.3's method API.
const destination = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2] ?? "");
const revision = "0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968";
const version = "0.1.0-beta.166-floor.0adbcff.403.2";
const directories = ["effect-agent", "storage-sql", "storage-cloudflare", "platform-cloudflare", "platform-alchemy-cloudflare", "testing"];
const run = (cmd, cwd = source) => {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).trim();
};
if (run(["git", "rev-parse", "HEAD"]) !== revision) throw new Error("Unexpected Yielded revision");
run(["git", "diff", "--exit-code", "HEAD", "--", "patches"]);
if (run(["git", "diff", "HEAD", "--", "packages"]) !== (await Bun.file(join(destination, "effect-4.0.3-crypto.patch")).text()).trim()) throw new Error("Unexpected implementation changes");
const root = await Bun.file(join(source, "package.json")).json();
if (root.catalog.effect !== "4.0.3" || root.catalog.alchemy !== "2.0.0-beta.80") throw new Error("Unexpected runtime pins");
const sha256 = async (path) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
const filesUnder = async (directory, prefix = "") => {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await filesUnder(join(directory, entry.name), relative + "/"));
    else if (entry.isFile()) files.push(relative);
    else throw new Error("Unexpected non-file entry");
  }
  return files;
};
const manifests = await Promise.all(directories.map(async (directory) => ({
  directory,
  manifest: await Bun.file(join(source, "packages", directory, "package.json")).json(),
})));
const privateNames = new Set(manifests.map(({ manifest }) => manifest.name));
const upstreamVersions = new Map();
for (const entry of await readdir(join(source, "packages"), { withFileTypes: true })) {
  const file = Bun.file(join(source, "packages", entry.name, "package.json"));
  if (entry.isDirectory() && await file.exists()) {
    const manifest = await file.json();
    upstreamVersions.set(manifest.name, manifest.version);
  }
}
const packages = [];
const modifiedSource = [];
for (const path of run(["git", "diff", "--name-only", "HEAD", "--", "packages"]).split("\n").filter(Boolean)) {
  const original = Bun.spawnSync(["git", "show", revision + ":" + path], { cwd: source });
  if (original.exitCode !== 0) throw new Error("Cannot read original source");
  modifiedSource.push({ path, beforeSha256: new Bun.CryptoHasher("sha256").update(original.stdout).digest("hex"), afterSha256: await sha256(join(source, path)) });
}
for (const { directory, manifest } of manifests) {
  const original = join(source, "packages", directory);
  const staging = join(source, "work-floor-pack", version, directory);
  await mkdir(staging, { recursive: true });
  for (const part of ["src", "dist"]) await cp(join(original, part), join(staging, part), { recursive: true });
  await cp(join(source, "LICENSE"), join(staging, "LICENSE"));
  const readme = Bun.file(join(original, "README.md"));
  if (await readme.exists()) await cp(readme.name, join(staging, "README.md"));
  const packed = { ...manifest, version };
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (manifest[section] === undefined) continue;
    packed[section] = {};
    for (const [name, range] of Object.entries(manifest[section])) {
      const resolved = privateNames.has(name) ? version
        : range === "workspace:*" ? upstreamVersions.get(name)
        : range === "catalog:" ? root.catalog[name] : range;
      if (typeof resolved !== "string" || resolved.startsWith("workspace:") || resolved.startsWith("catalog:")) throw new Error("Unresolved dependency " + name);
      packed[section][name] = name === "effect" || name.startsWith("@effect/") && resolved === "4.0.3" ? "4.0.3"
        : name === "alchemy" ? "2.0.0-beta.80" : resolved;
    }
  }
  packed.exports = {};
  for (const [key, target] of Object.entries(manifest.exports)) {
    if (typeof target !== "string" || !/^\.\/src\/((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+)\.ts$/.test(target)) throw new Error("Unexpected export");
    const stem = target.replace("./src/", "./dist/").replace(/\.ts$/, "");
    const entry = { types: stem + ".d.mts", default: stem + ".mjs" };
    for (const path of Object.values(entry)) if (!await Bun.file(join(staging, path)).exists()) throw new Error("Missing compiled export " + path);
    packed.exports[key] = entry;
  }
  await Bun.write(join(staging, "package.json"), JSON.stringify(packed, null, 2) + "\n");
  const filename = manifest.name.replace("@", "").replace("/", "-") + "-" + version + ".tgz";
  run(["bun", "pm", "pack", "--quiet", "--filename", join(destination, filename)], staging);
  const sourceFiles = [];
  for (const path of await filesUnder(join(original, "src"))) sourceFiles.push({ path: "src/" + path, sha256: await sha256(join(original, "src", path)) });
  packages.push({
    name: manifest.name, directory, version, filename,
    bytes: (await stat(join(destination, filename))).size,
    sha256: await sha256(join(destination, filename)),
    upstreamManifestSha256: await sha256(join(original, "package.json")),
    packedManifestSha256: await sha256(join(staging, "package.json")),
    sourceFiles,
    compiledExportCount: Object.keys(packed.exports).length,
  });
}
await cp(join(source, "bun.lock"), join(destination, "build.bun.lock"));
await cp(join(source, "package.json"), join(destination, "build.package.json"));
if (await sha256(join(source, "patches/alchemy@2.0.0-beta.80.patch")) !== await sha256(join(destination, "../../../patches/alchemy@2.0.0-beta.80.patch"))) throw new Error("Alchemy patch differs from the repository copy");
await cp(join(source, "LICENSE"), join(destination, "LICENSE"));
await Bun.write(join(destination, "provenance.json"), JSON.stringify({
  upstream: { repository: "https://github.com/yielded-dev/agent", revision, pullRequest: "https://github.com/yielded-dev/agent/pull/557", implementationModified: true, patch: "effect-4.0.3-crypto.patch", patchSha256: await sha256(join(destination, "effect-4.0.3-crypto.patch")) },
  modifiedSource,
  runtime: { effect: "4.0.3", alchemy: "2.0.0-beta.80", bun: Bun.version },
  build: { command: "bun run build", tool: "vite-plus 0.3.3 / vp pack", declarations: true, sourceMaps: true, sourceExportsConvertedUsing: "scripts/release-publish.ts withPublishManifests" },
  buildInputs: await Promise.all(["build.package.json", "build.bun.lock", "../../../patches/alchemy@2.0.0-beta.80.patch", "LICENSE"].map(async (path) => ({ path, sha256: await sha256(join(destination, path)) }))),
  packages,
}, null, 2) + "\n");
console.log(JSON.stringify(packages.map(({ name, filename, bytes, sha256 }) => ({ name, filename, bytes, sha256 })), null, 2));
