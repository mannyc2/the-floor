# CI admin configuration, attempt 001

The repaired admin stack installed both expected GitHub secrets; metadata supports retention of the existing preview token. This passes the bounded admin-configuration check. Remote CI, runner execution, preview deployment, the deployed flow and teardown remain unverified.

## Cause and repair

At 18:35:50 UTC on 12 October 2026, the initial configuration minted the intended `floor-preview-ci` token and installed the account-ID secret, but missed the API-token secret. Both the Cloudflare token and GitHub secret used the logical ID `PreviewToken`. Alchemy 2.0.0-beta.80 keys the stack registry by logical ID across resource types, so the second constructor returned the already registered Cloudflare token instead of registering a GitHub secret.

The offline reproduction uses the real installed constructors, synthetic inputs and a synthetic Stack. It blocks fetch, performs no remote-state operation and records zero fetch attempts. The collision returns the same object with the Cloudflare token type. Naming only the GitHub resource `PreviewTokenSecret` produces two distinct resources of the intended types.

Commit `3f62e6dd2b25db11da9c94d45b677558a971024b` changes only `stacks/github.ts` from base `6efcd6148f169d18d4b4a0b242404b2780cb2c1d`. The immutable source and exact patch are in `source/`. The retry installed `CLOUDFLARE_API_TOKEN` at 18:39:15 UTC. GitHub metadata also confirms `CLOUDFLARE_ACCOUNT_ID`, updated at 18:35:50 UTC; no secret values were requested or captured.

The independently collected Cloudflare metadata shows one intended preview token, active, issued and last modified at 18:35:50 UTC, before the retry. This supports retention of the original token. No token ID was captured before the repair, so there is no direct before/after ID comparison. The retained result omits account identifiers, account-wide counts and all other token metadata.

## Local checks

All seven checks against the base plus the sole source overlay passed: formatting, typecheck, lint, 56 leaf tests (1,333 assertions), build, native tests (36 assertions across three processes), and one production-entry browser flow. The browser flow checks typed-health connectivity locally; it does not establish an unimplemented product promise or a deployed preview. `checks/` retains the original logs. The later world-document merge checks are a separate execution and are not represented by these logs.

## Manual workflow diagnostic

The operator set `FLOOR_PREVIEW_CONFIGURED=false` at 18:43:54 UTC, then dispatched cleanup for `pr-1`. GitHub returned [run 38292952094](https://github.com/mannyc2/the-floor/actions/runs/38292952094), created at 18:44:29 UTC against public commit `b606b0224b50ebbf86846ca78968e97057551604`. The run and sole cleanup job are terminal with conclusion `skipped`; the job contains no steps. The original dispatch response, initial queued observation and fresh terminal observation are retained.

This proves manual-event registration and job-condition evaluation only. It does not prove runner execution, automatic push/PR triggers, use of the credentials, preview creation or cleanup. The current run list contains only this manual run. The reset-to-false time is operator-reported; run timestamps and terminal state are from retained GitHub metadata.

After the terminal observation, the operator restored `FLOOR_PREVIEW_CONFIGURED=true`; current GitHub metadata dates that update at 18:45:36 UTC. `FLOOR_PREVIEW_PR`, `FLOOR_PREVIEW_ENABLED` and `FLOOR_UPLOAD_ARTIFACTS` remain absent. Deployment admission is still closed.

## Scope and retention

The admin command used the separate `floor-admin` profile, selected account and `mannyc2/the-floor` repository; its exact invocation is in `commands.txt`. The retained stack configures preview authority with Workers Scripts Write and Secrets Store Write on that selected account, and no token-creation permission. The token metadata retained here does not independently list its policies. The configured flag depends on both secret resources. No preview stage was created by this evidence-packaging work or the skipped diagnostic. The intended preview token and repository secrets are retained for the authorized CI proof.

The collision source is archived as text because its relative import expects its original `work/ci-proof/resource-collision/` location. Do not execute that text from the evidence folder. The first and retry admin command consoles were not retained; their observations are attributed to the operator and corroborated by the independent metadata and reproduction. No token values, authorization headers, other-account resources or private profile files are retained. Incremental billed cost is unknown.
