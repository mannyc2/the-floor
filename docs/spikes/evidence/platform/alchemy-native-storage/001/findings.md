# Native Alchemy storage: local runtime evidence

**Passed for local Durable Object SQLite and D1.** Both stores initialized from two migration files, preserved their rows after an intentional rollback, produced exactly one winner among 16 conditional updates, and retained identical final rows and migration history in a new Bun/workerd process.

| Check | Durable Object SQLite | D1 |
| --- | --- | --- |
| Native API | `DurableObjectState` and `SqlMigrations` | `Database`, `QueryDatabaseBinding` and `alchemy/SQL/D1` |
| Schema initialization | Two ordered migrations; marker `migration-2` | Two ordered migrations; marker `migration-2` |
| Forced rollback | Update followed by tagged `RollbackProbe` failure | Update plus duplicate-primary-key insert in one atomic batch |
| State after failed operation | Matches the preceding row and history | Matches the preceding row and history |
| Conditional updates | 1 winner from 16 attempts; final version 1 | 1 winner from 16 attempts; final version 1 |
| Clean process restart | Final row and two history entries identical | Final row and two history entries identical |

The first process ran 26 assertions; the separate restart process ran seven. A later native build/readiness check passed one assertion and destroyed its resources. The native agent callback checks also passed again: six canonical records completed during a 3,021 ms interval without polling, survived restart, and remained unchanged after duplicate admission and a 1,505 ms quiet interval.

The Durable Object uses a real Alchemy storage transaction. D1 uses `SQL.D1`'s atomic batch: its `SqlError` retains the duplicate-key cause. These are distinct capabilities; the installed D1 driver rejects interactive transaction acquisition. No credentials were needed for local D1: the dev provider uses a local database identity and a workerd simulator. No hosted provider or model was called.

Both migration files were applied to **fresh storage**. This does not test a populated v1-to-v2 production upgrade. The Durable Object explicitly reapplies the captured migrations without changing its data/history; D1 remains a no-op resource on the restart deployment. The restart is a clean runtime-process restart, not a midflight kill, eviction or power-loss test. The 16 conditional updates are finite local contention within one run, not distributed contention or a throughput result.

The 19 KB archive freezes 15 as-run files, including both migration SQL files. The runtime fixture and tests still match the captured bytes. The only later difference among archived files is dprint’s nested cache/intermediate exclusions. The earlier typecheck preceded the finite-concurrency literal and suppression-comment adjustment; root subsequently passed the complete frozen-install, formatting, typecheck, lint and local build gates and independently reviewed the evidence. The root build also ran a separate Kit probe; that section is excluded from this storage build artifact.

Alchemy destroyed the native Worker, its bindings and local D1 resource after the restart test and build. This removes the logical resource state; local D1 simulator files can remain under ignored `.alchemy` until separately removed. No hosted resources were created. Cost remains unknown because billing was not queried.

This record does not establish hosted compatibility, exactly-once external effects, browser behavior or Stage 0 completion. See [record](record.json), [measured summary](result-summary.json), [admission/storage result](admission-result.json), [restart result](restart-result.json), [test log](root-storage-test.log), [native build log](native-storage-build.log), and [source manifest](executed-source-manifest.json).

Independent root review passed: Root independent technical review: read the native DO and D1 implementation and tests; verified all 15 archived source hashes, typed rollback causes, both 16-attempt/one-winner results, migration hashes, exact restart snapshots and unchanged agent records. Current runtime fixture bytes equal the as-run archive. The only later archived-file difference is dprint exclusion paths. Final root frozen install, format, typecheck, lint and both local build hooks passed. Accepted within the stated local/fresh-storage limits.
