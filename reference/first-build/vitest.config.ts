import { Effect, Path } from "effect";
import { defineConfig } from "vitest/config";
import { projectPaths } from "./scripts/build-paths.ts";

const configuration = Effect.gen(function*() {
  const { aliases } = yield* projectPaths;
  return {
    resolve: { alias: aliases },
    test: {
      include: [
        "scripts/**/test/**/*.test.ts",
        "packages/**/test/**/*.test.ts",
        "testing/flows/**/*.test.ts",
        "testing/bench/test/**/*.test.ts",
      ],
      testTimeout: 20000,
    },
  };
});

// oxlint-disable-next-line effecttsgo/strict-effect-provide -- Vitest configuration is the test composition root, outside any test Effect.
export default defineConfig(() => Effect.runPromise(configuration.pipe(Effect.provide(Path.layer))));
