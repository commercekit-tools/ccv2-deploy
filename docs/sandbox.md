# Manual Sandbox verification

**NOT EXECUTED.** Do not dispatch until PR reviewed, CI green, and owner explicitly approves.

The manual-only workflow requires `RUN-COMMERCEKIT-SANDBOX-DEPLOY` and one fixed scenario: rolling-success, rolling-failure, nonterminating, rate-limit, create-error, green-manual, green-accept, green-prepare-canary, green-reject, cancel. It fixes the origin to the public CommerceKit Sandbox and never accepts SAP credentials or arbitrary URLs.

Preparation creates exactly one disposable run, masks generated credentials before output, configures scenario state, uses the pinned shared CCv2 client to get a synthetic OAuth token, creates and polls a successful prerequisite build, and discovers a seeded environment. Only cancel prepares an existing deployment. Green scenarios exercise deploy plus decision; unit tests separately exercise resume and decide. Canary smoke includes a synthetic commerce service split.

The local bundled Action runs with a 10-second poll interval and one-minute deadline. Assertions validate event schema, outcome, status, output agreement, credential exclusion, run resource counts, canary flags and create-error call count. Cleanup runs with `if: always()` using the control token. Cleanup failure fails safely; run expiration remains a fallback. No artifacts are uploaded. Hard runner termination can prevent cleanup.

No live run was created during implementation. Read-only contract downloads do not exercise these scenarios. Later coordinated tests must use the build Action and real producer events through notify, with separately approved Slack/Teams smoke tests, before release.
