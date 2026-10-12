# Native Alchemy agent: local run and restart

**Passed for the bounded local runtime.** Alchemy's callback Durable Object scheduled admission into Yielded's native Alchemy `ThreadObject`. The agent completed the scripted answer during a **3,004 ms interval without polling**. All six canonical records and the callback timestamps survived a new Bun/workerd process. Repeating the same admission key added **zero records** during a further **1,509 ms interval without polling**.

The records are `ThreadCreated`, `UserInputRecorded`, `RunStarted`, `ModelResponseRecorded`, `RunCompleted`, and `SubmissionSettled`. The completed output is `{"answer":"synthetic-done-v1"}` and settlement is `completed`. The scripted model delays its first stream by 250 ms. Callback completion occurred 315 ms after the quiet interval began; run completion at 657 ms and settlement at 671 ms establish that these events preceded the first follow-up request.

The build test and two agent tests passed with 12 assertions in total. The first agent process retained its local resource identity while the harness closed its runtime scope. A second process updated that same local identity, read the saved records, exercised duplicate admission, and destroyed the resources. Both the build and restart logs report successful destruction; local port 19732 had no listener when this evidence was packaged. Ignored scratch files may remain.

This is Alchemy `Test.make({ dev: true, sidecar: false })` and the native Yielded Alchemy adapter at upstream commit `0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968`, with the unchanged beta.80 patch and upstream lockfile. The installed graph uses Alchemy `2.0.0-beta.80`, Effect `4.0.0`, and Yielded package manifests `0.1.0-beta.166`. The operator observed workerd `1.20260918.1`. The Worker declares compatibility date `2026-08-18` and flags `[]`; Alchemy/runtime defaults apply, so this does not establish disabled Node compatibility.

The 17 KB source archive preserves the **as-run** fixture and captured toolchain configuration. Its 13 files matched the authored source at capture. Later native storage additions belong to a separate run and must not replace this snapshot. The repository compiler and lint checks were reported passing; the captured script preserves the strict consumer settings and checks upstream dependency declarations built with upstream settings.

No hosted stage, provider model, browser, wallet, transaction, or cloud credentials were used. The host preload allows only loopback fetch, and the fixture's model is scripted. That host guard is not a general Worker egress or browser-containment proof. Cost is unknown because billing was not queried.

This result does not prove interrupted inference recovery, eviction or power-loss recovery, hosted Durable Object behavior, real inference, browser lifecycle, D1 storage, or exactly-once external side effects. It does not complete Stage 0. Root independently reviewed the frozen source, hashes, timestamp relationships and stored records; the bounded technical result is accepted. No owner or Stage 0 approval is implied.

See [record](record.json), [measured summary](result-summary.json), [admission result](admission-result.json), [restart result](restart-result.json), [build log](root-build.log), [test log](root-test.log), and [as-run source manifest](executed-source-manifest.json).
