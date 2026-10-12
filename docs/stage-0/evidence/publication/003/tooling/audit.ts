import { createHash } from 'node:crypto';

export const excludedPrefix = 'reference/cafe-reference';
export const destinations = [
  'https://github.com/mannyc2/the-floor.git',
  'git@github.com:mannyc2/the-floor.git',
] as const;
export const decoder = new TextDecoder('utf-8', { fatal: true });

export function command(cwd: string, argv: readonly string[]): string {
  const result = Bun.spawnSync([...argv], {
    cwd,
    env: { ...Bun.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`${argv[0]} ${argv[1]} failed (${result.exitCode}): ${decoder.decode(result.stderr)}`);
  }
  return decoder.decode(result.stdout);
}

export function git(cwd: string, ...argv: string[]): string {
  return command(cwd, ['git', ...argv]);
}

export function lines(value: string): string[] {
  return value.trim().length === 0 ? [] : value.trimEnd().split('\n');
}

export function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function excluded(path: string): boolean {
  return path === excludedPrefix || path.startsWith(`${excludedPrefix}/`);
}

export interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly oid: string;
}

export function tree(cwd: string, commit: string): TreeEntry[] {
  return git(cwd, 'ls-tree', '-rz', '--full-tree', commit)
    .split('\0')
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      assert(tab > 0, 'Malformed git tree entry');
      const [mode, type, oid] = entry.slice(0, tab).split(' ');
      assert(mode !== undefined && type !== undefined && oid !== undefined, 'Incomplete git tree entry');
      return { mode, type, oid, path: entry.slice(tab + 1) };
    });
}

export function refs(cwd: string): Record<string, string> {
  return Object.fromEntries(lines(git(cwd, 'for-each-ref', '--format=%(refname) %(objectname)')).map((line) => {
    const [name, oid] = line.split(' ');
    assert(name !== undefined && oid !== undefined, 'Malformed git ref');
    return [name, oid];
  }));
}

export function commits(cwd: string, tips: readonly string[] = ['--all']): string[] {
  return lines(git(cwd, 'rev-list', '--topo-order', ...tips));
}

export function auditClosure(cwd: string, tips: readonly string[], forbiddenBlobs: ReadonlySet<string>) {
  const reachable = commits(cwd, tips);
  let inspectedEntries = 0;
  const keptBlobs = new Set<string>();
  for (const commit of reachable) {
    for (const entry of tree(cwd, commit)) {
      assert(!excluded(entry.path), `Excluded path remains at ${commit}: ${entry.path}`);
      assert(!forbiddenBlobs.has(entry.oid), `Excluded blob remains at ${commit}: ${entry.path}`);
      if (entry.type === 'blob') keptBlobs.add(entry.oid);
      inspectedEntries += 1;
    }
  }
  return { commits: reachable.length, inspectedEntries, uniqueBlobs: keptBlobs.size };
}
