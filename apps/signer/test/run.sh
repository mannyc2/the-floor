#!/bin/sh
set -eu
sh apps/signer/test/install-surfpool.sh
bun apps/signer/test/clone-programs.ts
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./apps/floor/test/local-only.ts ./apps/signer/test/native.test.ts
