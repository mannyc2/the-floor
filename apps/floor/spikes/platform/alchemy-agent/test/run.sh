#!/bin/sh
set -eu
CI=true ALCHEMY_TELEMETRY_DISABLED=1 FLOOR_RETAIN_LOCAL_STATE=1 bun test --preload ./test/local-only.ts ./test/admission.test.ts
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./test/local-only.ts ./test/restart.test.ts
