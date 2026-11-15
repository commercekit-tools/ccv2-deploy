# Consistent Action reporting

## Published dependency and scope

The owner-authorized [package-only publication run 43678067818](https://github.com/commercekit-tools/action-kit/actions/runs/43678067818)
published notification-contract **0.0.6** from action-kit main
`3fecce40414d709884fa48e48eca278f470b20b0`. Main
[CI 43677942127](https://github.com/commercekit-tools/action-kit/actions/runs/43677942127)
and [CodeQL 43677942074](https://github.com/commercekit-tools/action-kit/actions/runs/43677942074)
passed; processed main analysis was `2169851728`.

Actual registry metadata was independently read back before consumer changes:

- Exact dependency: `@commercekit-tools/notification-contract@0.0.6`.
- Shasum: `8030f643d1dd6d741caa2c3c0ba321ad82b30cca`.
- Integrity: `sha512-n6F84900sDPBeYm5dnf8HLCM9B2DUVATEeF717dqKsSXTJtq1FIj/3hZ2UcNTtXe7v8R90HYF6HIom4auM8Kyw==`.
- Artifact SHA256: `e4b79576328c2992a96fed087e9ba6e63970e8b54d6fca976a6652702a7a73a9`, identical to the exact reviewed source tarball.
- ccv2-client remains exact published **0.0.3**.

The normal manifest and registry lockfile pin these actual published packages;
the committed bundle includes runtime dependencies. No local source checkout,
file dependency, candidate environment flag, package token or installation is
required to execute the bundled Action. Development installation uses authorized
read-only GitHub Packages access.

Input names/defaults, endpoint validation, remote mutations, polling/deadlines,
retry/refresh policies and domain outcomes remain unchanged. Shared input
capture/projection, schema/factories, redaction, status styling and Markdown
summaries come from the existing notification-contract package. OAuth/HTTP
remain in ccv2-client; delivery remains in Notify. No subsystem was duplicated.

## Notification and summary behavior

Every handled outcome reports all **21 input names**. Valid configuration
uses effective normalized defaults; invalid configuration shows safely captured
settings with `inputsValidated=false`. Capture reads each input once and masks
the four authentication values before any public field is read. Token endpoint,
client ID, client secret and resource are always literal `[REDACTED]` in public
context. Received tokens continue to use the existing Action masker.

Shared known-secret/JWT redaction precedes the 256-character per-value bound;
truncation is explicit. API URLs use only a validated safe HTTPS origin. Arbitrary
credential-bearing URLs are not reflected. Missing optional values are visible
as not set. Markdown/HTML control syntax is escaped by the shared renderer.

Deploy includes all operation, deployment/build/environment, database/strategy,
green-decision, rollback, waiting and polling settings. The three free-form or
structured inputs `decision-reason`, `cancel-reason` and `traffic-split-json`
show presence only; raw request/reason bodies are never copied to outputs,
notifications or summaries. This also applies before validation completes.
Manual/canary handoff keeps the existing `action-required` event/status and
uses the shared warning style with a safe instruction to review the deployment.
Cancellation/traffic-update outcomes appear as named result rows.

Each execution attempts a GitHub job summary after outputs, including handled
input/API/authentication/timeout failures. The shared layout is an icon/status
heading followed by Result and Inputs tables, safe Issues when present, and a
validated workflow link when available. Human labels replace internal property
names. Icons/labels reuse the shared status mapping:

| Outcome                       | Style                | Operation behavior                                |
| ----------------------------- | -------------------- | ------------------------------------------------- |
| success                       | ✅ Succeeded         | Existing success behavior                         |
| failure                       | ❌ Failed            | Existing failure behavior                         |
| internal-error                | ❌ CommerceKit error | Existing validation/API/deadline failure behavior |
| cancelled                     | ⏹️ Cancelled         | Existing Action exit policy is retained           |
| action-required (Deploy only) | ⚠️ Action required   | Existing non-failing manual/canary handoff        |

Trusted local outcome/operation enums (and allowlisted Build statuses) retain
their actual semantics when a credential coincidentally equals an enum word.
Public copies of supplied input values remain redacted. Arbitrary API strings
are never restored after sanitization. This prevents masking from manufacturing
an invalid event or a different domain outcome.

Structured result/event JSON is bounded to **64 KiB**, deliberately raised from
16 KiB for the unreleased reporting enhancement. All 21 invalid deployment settings
can expand under JSON Unicode escaping even when each projected value is bounded
to 256 characters. A worst-case malformed-Unicode test verifies a valid event over
16 KiB remains present, schema-valid and below 64 KiB with all input names.
Scalar outputs retain their existing bound and endpoint field validation.

Reporting cannot overwrite the operation result. Event creation failure emits
an empty notification output, a safe warning and an issue in the available
summary; consumers must skip notification delivery when the event is empty.
Each output is attempted independently, and the summary is still attempted if
an output write fails. An output contract failure can fail the Action separately
while keeping the original domain result/event status. An existing operation
error remains the primary Action failure. Summary errors warn without erasing
outputs or changing the operation outcome.

## Registry-backed validation

Status vocabulary: PASS, FAIL, BLOCKED, NOT RUN.

| Check                                                     | Result                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Registry availability and integrity                       | PASS: actual published 0.0.6 independently verified                                                                 |
| Normal frozen dependency installation                     | PASS: exact registry versions and reproducible lockfile                                                             |
| Normal standalone bundle generation                       | PASS: SHA256 `540d42a2072000d1ffa884c22a7eac933233a5a584c6831be85a1472d1e7744e`, identical to reviewed v2 candidate |
| Full normal quality, tests and coverage                   | PASS: 312 tests/12 files, zero skipped; 99.12% statements, 97.48% branches, 98.57% functions, 99.76% lines          |
| Required hosted checks and coordinated source merge       | NOT RUN: pending final pushed head                                                                                  |
| Real SAP, hosted Sandbox dispatch, live provider delivery | NOT RUN in this reporting task                                                                                      |

Normal commands use Node 24.21.0/pnpm 12.6.0 and need no candidate variables:

```sh
pnpm install --frozen-lockfile
pnpm bundle
pnpm quality
```

Quality includes format, lint, strict types, public schema/compatibility tests,
coverage, bundle byte consistency, public scan and production dependency audit.
All normal commands above passed against the actual registry package, without
candidate variables. Public scan checked 65 files; the production dependency audit
reported no known vulnerabilities. Source `git diff --check` passed as well.
Existing 95% statement/branch/function/line thresholds and production source
inclusion remain unchanged. Actual standalone bundle cases verify all 21
input names, status icons/tables, safe error explanations, masking and zero mocked
API requests for invalid configuration. The original remote-operation suites
remain in place; passing repository checks is not live SAP validation.

## Historical source-candidate validation

Before publication the exact reviewed source candidate at action-kit
`475cc4db42f79310240496201f90d7047aa54330` was validated in fresh private
consumers. Its 19140-byte tarball has the same integrity and SHA256 recorded
above. Those candidate results passed **312 tests in 12 files** with
99.12% statements, 97.48% branches, 98.57% functions, 99.76% lines. Privacy review independently proved lowercase/mixed
percent-escape redaction and canonical trailing-dot Slack/Slack Gov webhook
masking across input snapshots, summary facts and links. Producer tests exercise
mixed-case URL/form-encoded credentials in actual result/event/summary sinks.

The original source-stage procedures, candidate-only switching and complete
validation evidence are archived at immutable consumer commit
[`56e037ca68d5adbc53438733020b65a8b4f65b2f`](https://github.com/commercekit-tools/ccv2-deploy/tree/56e037ca68d5adbc53438733020b65a8b4f65b2f)
([report](https://github.com/commercekit-tools/ccv2-deploy/blob/56e037ca68d5adbc53438733020b65a8b4f65b2f/docs/consistent-reporting.md)).
They are historical evidence; current scripts assert only exact registry versions
and reject file dependencies. Candidate compatibility overrides were removed.

## Remaining release and validation gates

The dependency-publication gate is resolved. Normal validation and hosted checks
on the final source head must pass before the authorized source merge; they
cannot be replaced by candidate results or weakened checks. Action publication,
Marketplace/version tags, hosted provider smoke, coordinated live validation and
owner release approval remain separately governed by RELEASING.md. No Git tag,
Action release, deployment, live provider send or real SAP request occurred.
