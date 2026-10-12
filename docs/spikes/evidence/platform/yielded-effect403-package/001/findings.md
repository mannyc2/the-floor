# Unpatched packed build: runtime failure

The first private package build used the exact Yielded PR 557 implementation
at `0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968` with Effect 4.0.3. Package
bundling and the strict Floor consumer checks passed, but the real local
Durable Object alarm failed: `randomUUIDv7.pipe is not a function`.
The following snapshot consequently failed with `ThreadNotMaterialized`.

Effect 4.0.3 exposes UUID generators as methods. The upstream implementation
expects Effect-valued properties. This failure establishes why imports,
declaration generation and successful bundling do not establish runtime
compatibility. The initial archives are retained in ignored work and identified
by SHA-256; they must not be used by active consumers.

The native runtime binary initially failed before execution because the local
Bun cache contained a corrupt workerd executable. The operator replaced only
the new installation's binary from the previously integrity-verified official
distribution. The UUID failure occurred after that environment repair.

The failed attempt's complete original consumer lock was not frozen before the
manifest was advanced to build 2. The six exact package archives, fixed upstream
revision, Worker failure log and driver failure are retained. This record claims
the observed compatibility failure, not a complete reproducibility certificate.
Attempt 002 adds a separately recorded four-call compatibility patch.
