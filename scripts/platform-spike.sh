#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
agent="$root/apps/floor/spikes/platform/alchemy-agent"
kit="$root/apps/floor/spikes/platform/kit"
command=${1:-test}

# Both active consumers use the accepted Effect version. Frozen historical
# evidence retains its own as-run source and dependency graph.
bun "$root/scripts/vendor/verify.ts"
case "$command" in
  prepare)
    (cd "$agent" && bun install --frozen-lockfile)
    (cd "$kit" && bun install --frozen-lockfile)
    ;;
  typecheck|lint|build)
    case "$command" in
      typecheck) "$root/node_modules/.bin/tsc" -p "$root/scripts/vendor/tsconfig.json" ;;
      lint) "$root/node_modules/.bin/oxlint" --type-aware --type-check --deny-warnings --tsconfig "$root/scripts/vendor/tsconfig.json" -c "$root/.oxlintrc.json" "$root/scripts/vendor" ;;
    esac
    (cd "$agent" && bun run "$command")
    (cd "$kit" && bun run "$command")
    ;;
  test) (cd "$agent" && bun run test) ;;
  *) echo "Expected prepare, typecheck, lint, build or test." >&2; exit 2 ;;
esac
