import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const provenance = await Bun.file(join(directory, "provenance.json")).json();
const hash = async (path) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
for (const artifact of [...provenance.buildInputs, ...provenance.packages.map((pkg) => ({ path: pkg.filename, sha256: pkg.sha256 }))]) {
  if (await hash(join(directory, artifact.path)) !== artifact.sha256) throw new Error("Yielded artifact mismatch: " + artifact.path);
}
if (await hash(join(directory, provenance.upstream.patch)) !== provenance.upstream.patchSha256) throw new Error("Yielded compatibility patch mismatch");
for (const pkg of provenance.packages) {
  const tarball = join(directory, pkg.filename);
  const list = Bun.spawnSync(["tar", "-tf", tarball]);
  const manifest = Bun.spawnSync(["tar", "-xOf", tarball, "package/package.json"]);
  if (list.exitCode !== 0 || manifest.exitCode !== 0) throw new Error("Unreadable package archive");
  const paths = new Set(new TextDecoder().decode(list.stdout).split("\n"));
  const parsed = JSON.parse(new TextDecoder().decode(manifest.stdout));
  if (parsed.name !== pkg.name || parsed.version !== pkg.version || !paths.has("package/LICENSE")) throw new Error("Package identity or license mismatch");
  if (new Bun.CryptoHasher("sha256").update(manifest.stdout).digest("hex") !== pkg.packedManifestSha256) throw new Error("Manifest hash mismatch");
  for (const target of Object.values(parsed.exports)) {
    if (typeof target !== "object" || target === null) throw new Error("Unexpected source export");
    for (const path of Object.values(target)) {
      if (typeof path !== "string" || !path.startsWith("./dist/") || !paths.has("package/" + path.slice(2))) throw new Error("Missing compiled export");
    }
  }
}
console.log("Verified six private Yielded packages, compiled exports, licenses and pinned patches.");
