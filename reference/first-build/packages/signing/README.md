# Signing boundary

The signing package receives decoded proposals, owner-confirmed policy and authoritative account facts. It does not import an agent runtime, inference provider or research browser. Policy checks are pure functions; provider calls are Effects behind `TransactionExecutor` and `SigningJournal` services.

`evaluatePolicy(proposal, policy, context)` returns named checks and an allow, approval or refusal decision. `createReceipt(...)` records that decision. `authorizeReceipt(...)` and `updatePolicy(...)` return `Result`, so refusal remains an expected typed outcome. The canonical proposal fingerprint binds approval to the complete decoded proposal, including its exact decimal amount and recipient.

`dispatchApproved(receiptId)` acquires authority through one fresh atomic transition from approved to executing. Seeing an existing executing receipt never grants authority to send. A journal adapter must compare the receipt, current policy and current account exposure in the same transaction when reserving execution. When saving observed transaction evidence, it compares the receipt alone: a concurrent policy change must not discard a transaction that was already sent.

`Signing.layer` captures `SigningJournal` and `TransactionExecutor` at construction. Its `dispatchApproved(receiptId)` method has no remaining service requirements, so long-lived workspace and HTTP services can capture `Signing` without leaking provider dependencies into individual handlers. The standalone dispatcher remains available for direct composition and focused tests.

Known rejection before acceptance becomes failed. An ambiguous provider response becomes uncertain. Losing the final receipt commit leaves executing durably recorded. All of these states survive restart; neither executing nor uncertain is automatically resent. `reconcileDispatch(receipt, observation)` accepts independently observed transaction evidence for the original attempt. A confirmed receipt requires both a valid hash and a block; the schema cannot represent a confirmation without them.

The default `TransactionExecutor.unavailable` layer refuses to sign. A configured adapter must implement the same service contract and classify the provider's acceptance boundary accurately. External account, paymaster and RPC credentials belong at the server composition root, never in the agent or renderer.

## Tests and replacement providers

Tests replace services through `Effect.provideService`, using the same `TransactionExecutor` and `SigningJournal` contracts as production. Each dispatch fixture acquires a unique temporary directory, a fresh semaphore and fresh counters inside its test scope. The shared Bun filesystem layer owns no receipt state. File round trips exercise durable reservation and restart behavior; fixture files are removed by the test scope.

Pure policy tests provide explicit clocks as `PolicyContext.now`. Any effectful scheduling test should use Effect's `TestClock` through `@effect/vitest`, not a second clock interface or a production test-mode flag. Database adapters should be tested with the same SQL implementation in an isolated database, while external execution is replaced by a focused service layer.
