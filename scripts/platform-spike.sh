#!/bin/sh
set -eu

# This unpublished adapter must keep its upstream workspace graph. The authored
# probes are copied byte-for-byte into that graph; no upstream source is edited.
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
clone="$root/work/alchemy-audit/yielded-agent"
revision=0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968
package="$clone/packages/platform-alchemy-cloudflare"
replay="$package/work-floor-replay"
source="$root/apps/floor/spikes/platform/alchemy-agent"
command=${1:-test}

if [ ! -d "$clone/.git" ]; then
  mkdir -p "$(dirname -- "$clone")"
  git clone --no-checkout --filter=blob:none https://github.com/yielded-dev/agent.git "$clone"
  git -C "$clone" checkout --detach "$revision"
fi
if [ "$(git -C "$clone" rev-parse HEAD)" != "$revision" ]; then
  echo "The platform probe requires the recorded Yielded revision." >&2
  exit 1
fi
git -C "$clone" diff --exit-code HEAD -- packages patches bun.lock
if [ ! -f "$package/node_modules/alchemy/package.json" ]; then
  (cd "$clone" && bun install --frozen-lockfile --ignore-scripts --filter @yielded/agent-platform-alchemy-cloudflare --filter @yielded/agent-testing)
fi
mkdir -p "$replay/test/fixtures"
mkdir -p "$replay/test/fixtures/migrations"
cp "$source"/test/*.ts "$replay/test/"
cp "$source"/test/fixtures/*.ts "$replay/test/fixtures/"
cp "$source"/test/fixtures/migrations/*.sql "$replay/test/fixtures/migrations/"
for file in "$source"/test/*.ts "$source"/test/fixtures/*.ts "$source"/test/fixtures/migrations/*.sql; do
  relative=${file#"$source/"}
  cmp "$file" "$replay/$relative"
done
# These generated configs inherit the unchanged root checks. Only path-specific
# ignores differ, because the verified copy deliberately lives in ignored work/.
bun -e '
const [root, source, replay] = process.argv.slice(1);
if (!root || !source || !replay) throw new Error("Missing replay paths");
const config = await Bun.file(`${source}/tsconfig.json`).json();
const paths = {};
for (const directory of ["effect-agent", "storage-sql", "storage-cloudflare", "platform-cloudflare", "platform-alchemy-cloudflare", "testing"]) {
  const manifest = await Bun.file(`${replay}/../../${directory}/package.json`).json();
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (typeof target !== "string" || !target.startsWith("./src/")) throw new Error("Unexpected dependency export");
    paths[manifest.name + (subpath === "." ? "" : subpath.slice(1))] = [`${replay}/dependency-types/${directory}/${target.slice(2).replace(/\.ts$/, ".d.ts")}`];
  }
}
await Bun.write(`${replay}/tsconfig.json`, JSON.stringify({ extends: "../../../tsconfig.base.json" }));
await Bun.write(`${replay}/tsconfig.check.json`, JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, paths }, extends: `${root}/tsconfig.json`, exclude: [] }, null, 2));
await Bun.write(`${replay}/.oxlintrc.json`, JSON.stringify({ extends: [`${root}/.oxlintrc.json`], ignorePatterns: [] }, null, 2));
' "$root" "$source" "$replay"

# Emit the upstream dependencies with their own strict compiler settings. The
# consumer keeps every Floor check and consumes these real declarations, as it
# would consume a published package, instead of rechecking upstream source with
# stricter Floor-only optional-property and indexed-access flags.
if [ ! -f "$replay/dependency-types/platform-alchemy-cloudflare/src/ThreadObject.d.ts" ]; then
  cat > "$replay/dependency-types.json" <<'TYPES'
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "./dependency-types",
    "rootDir": "../..",
    "types": ["@cloudflare/workers-types", "node"]
  },
  "include": ["../../effect-agent/src/**/*.ts", "../../storage-sql/src/**/*.ts", "../../storage-cloudflare/src/**/*.ts", "../../platform-cloudflare/src/**/*.ts", "../src/**/*.ts", "../../testing/src/**/*.ts"]
}
TYPES
  bun "$package/node_modules/typescript/bin/tsc" -p "$replay/dependency-types.json"
fi
for directory in effect-agent storage-sql storage-cloudflare platform-cloudflare platform-alchemy-cloudflare testing; do
  if [ ! -L "$replay/dependency-types/$directory/node_modules" ]; then
    ln -s "../../../../$directory/node_modules" "$replay/dependency-types/$directory/node_modules"
  fi
done

case "$command" in
  typecheck|lint) cp "$replay/tsconfig.check.json" "$replay/tsconfig.json" ;;
esac

case "$command" in
  prepare) (cd "$root/apps/floor/spikes/platform/kit" && bun install --frozen-lockfile) ;;
  typecheck) "$root/node_modules/.bin/tsc" -p "$replay/tsconfig.check.json" ;;
  lint) "$root/node_modules/.bin/oxlint" --type-aware --type-check --tsconfig "$replay/tsconfig.check.json" -c "$replay/.oxlintrc.json" "$replay/test" ;;
  build)
    (cd "$package" && CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./work-floor-replay/test/local-only.ts ./work-floor-replay/test/build.test.ts)
    ;;
  test)
    (cd "$package" && CI=true ALCHEMY_TELEMETRY_DISABLED=1 FLOOR_RETAIN_LOCAL_STATE=1 bun test --preload ./work-floor-replay/test/local-only.ts ./work-floor-replay/test/admission.test.ts)
    (cd "$package" && CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./work-floor-replay/test/local-only.ts ./work-floor-replay/test/restart.test.ts)
    ;;
  *) echo "Expected prepare, typecheck, lint, build or test." >&2; exit 2 ;;
esac

case "$command" in
  typecheck|lint|build) (cd "$root/apps/floor/spikes/platform/kit" && bun run "$command") ;;
esac
