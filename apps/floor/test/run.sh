#!/bin/sh
set -eu
mkdir -p work/stage-0-checks
CI=true ALCHEMY_TELEMETRY_DISABLED=1 FLOOR_RETAIN_LOCAL_STATE=1 bun test --preload ./apps/floor/test/local-only.ts ./apps/floor/test/admission.test.ts
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./apps/floor/test/local-only.ts ./apps/floor/test/restart.test.ts
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./apps/floor/test/local-only.ts ./apps/floor/test/gate.test.ts
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./apps/floor/test/local-only.ts ./apps/floor/test/world.native.test.ts
