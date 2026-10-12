import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, basename, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const transpiler = new Bun.Transpiler({ loader: 'js' });
const bundle = resolve(process.argv[2]);
const entry = join(bundle, 'entry.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const queue = [entry], seen = new Set(), files = [], missing = [], sources = [], packages = new Map(), external = new Set(), computed = [];
// Old Alchemy chunks stay in its cache, so only imports reachable from the current entry count.
while (queue.length) {
  const path = queue.pop();
  if (seen.has(path)) continue;
  seen.add(path);
  if (!existsSync(path)) { missing.push(path); continue; }
  const bytes = readFileSync(path);
  files.push({ path: relative(root, path), bytes: bytes.length, sha256: sha(bytes) });
  const imports = transpiler.scan(bytes).imports.map(item => item.path);
  for (const name of imports) {
    if (name.startsWith('.')) {
      const target = resolve(dirname(path), name);
      if (target.startsWith(bundle + sep)) queue.push(target);
      else missing.push(target);
    } else external.add(name);
  }
  const map = path + '.map';
  if (!existsSync(map)) continue;
  const mapBytes = readFileSync(map);
  files.push({ path: relative(root, map), bytes: mapBytes.length, sha256: sha(mapBytes) });
  const metadata = JSON.parse(mapBytes.toString());
  for (const name of metadata.sources ?? []) {
    const sourcePath = resolve(dirname(map), metadata.sourceRoot ?? '', name);
    sources.push({ map: relative(root, map), source: name });
    if (!existsSync(sourcePath)) continue;
    const resolved = realpathSync(sourcePath), parts = resolved.split(sep), index = parts.lastIndexOf('node_modules');
    if (index < 0) continue;
    const depth = parts[index + 1]?.startsWith('@') ? 2 : 1;
    const manifest = join(parts.slice(0, index + 1 + depth).join(sep), 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    const key = pkg.name + '@' + pkg.version, item = packages.get(key) ?? { name: pkg.name, version: pkg.version, manifest: relative(root, manifest), source_count: 0 };
    item.source_count++;
    packages.set(key, item);
  }
}
const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const oldStack = ['@solana/web3.js', '@coral-xyz/anchor', '@project-serum/anchor', 'bn.js', '@meteora-ag/dynamic-bonding-curve-sdk'];
console.log(JSON.stringify({
  entry: relative(root, entry),
  method: 'Bun parser scans static imports/exports and literal dynamic imports in emitted JavaScript. Only maps of reachable chunks identify packages; old cache chunks are excluded. Computed nonliteral imports are outside this static audit.',
  reachable_js_files: files.filter(file => file.path.endsWith('.js')).length,
  source_map_files: files.filter(file => file.path.endsWith('.map')).length,
  source_entries: sources.length,
  packages: list,
  forbidden_packages: list.filter(pkg => oldStack.includes(pkg.name) || (pkg.name.startsWith('@solana/') && pkg.version.startsWith('6.'))),
  missing_imports: missing,
  external_imports: [...external].sort(),
  computed_imports: 'Nonliteral imports are not resolved by this static audit',
  excluded_cached_js_files: readdirSync(bundle).filter(name => name.endsWith('.js') && !seen.has(join(bundle, name))).sort(),
  files,
}, null, 2));
