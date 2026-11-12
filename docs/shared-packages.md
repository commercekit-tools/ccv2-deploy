# Shared package ownership

Both packages are published GitHub Packages dependencies pinned exactly to **0.0.2**. No local checkout, workspace link, runtime registry request, or package publishing step is used. The Action remains **UNRELEASED**.

| Area                                                                          | Classification               | Ownership after migration                                                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Vendored notification schema, provenance, copy/update script, Ajv compilation | SHARED NOTIFICATION CONTRACT | Removed; package schema export and full validator                                                                                 |
| Event envelope, event types, context extraction, run URL, link validation     | SHARED NOTIFICATION CONTRACT | Package deployment factory and safe context helpers                                                                               |
| Technical-user token client/cache/refresh (`src/auth.ts`)                     | SHARED CCV2 CLIENT           | Removed; `TechnicalUserTokenManager`                                                                                              |
| HTTP, Retry-After, backoff, response/problem parsing (`src/http.ts`)          | SHARED CCV2 CLIENT           | Removed; `createCcv2Client`                                                                                                       |
| `src/client.ts`                                                               | MIXED — SPLIT                | Small Action adapter for runtime injection, masking, progress counting, and stable error translation; package owns transport      |
| `src/inputs.ts`                                                               | MIXED — SPLIT                | Package validates URLs; local code owns all operation-aware conditions and traffic split validation                               |
| `src/security.ts`                                                             | MIXED — SPLIT                | Shared transport/event redaction and sanitization; local exact-secret registration and conservative plain-text/JWT/summary policy |
| `src/notification.ts`                                                         | MIXED — SPLIT                | Local result-to-event field mapping and secret-aware environment prefilter; package owns envelope, context, links and validation  |
| `src/api.ts`                                                                  | DEPLOY-SPECIFIC — KEEP       | Endpoint paths, expected statuses/shapes, identities, modes, decision predicate and cancellation options                          |
| `src/action.ts`, `src/result.ts`, `src/errors.ts`                             | DEPLOY-SPECIFIC — KEEP       | Lifecycle, timeout outcome, safe result, outputs, summary and stable public error codes                                           |
| Sandbox helpers and assertions                                                | DEPLOY-SPECIFIC — KEEP       | Shared token manager/client for prerequisites and shared event validator; local fixed scenarios/control API/cleanup               |

## Request policies

| Request                                                                    | Policy            |
| -------------------------------------------------------------------------- | ----------------- |
| Deployment modes, detail, progress, decision history, cancellation options | `safe-read`       |
| Create deployment, submit decision, submit cancellation, traffic-split PUT | `unsafe-mutation` |

Unused traffic-split GET/history operations are not introduced by this migration. Every endpoint call explicitly passes a policy to the shared client. Safe reads and token exchange use at most three transient attempts. Unsafe mutations execute once after network failure, request timeout, 429, 5xx, or malformed success. Only explicit 401 permits one token-refresh replay. Endpoint adapters accept mode arrays and an empty 202 cancellation response; other DTO shapes remain endpoint-specific.

Shared transport errors map to existing Deploy errors. Problem title/detail remain suppressed in results, events, summaries and failures. Epoch time is supplied to shared Retry-After parsing while Action duration uses a monotonic clock. The existing overall AbortSignal bounds requests/retry sleeps and never triggers remote cancellation.

## Compatibility verification

The public `action.yml` inputs and outputs are unchanged. Tests exercise every operation, green handoff/ACCEPT/PREPARE_CANARY/REJECT, new deployment codes, optional traffic split, rollback eligibility and cancellation monitoring. Every Action test event is checked by the shared full validator. Package compatibility checks and regular CI are offline after dependency installation; no live Sandbox or provider webhook is invoked.

Dependencies are bundled into `dist/index.js` with notices in `dist/licenses.txt`. Workflow users need no package authentication. Maintainers and repository Actions require GitHub Packages read access; see [Contributing](../CONTRIBUTING.md). Package upgrades require full deployment regression, guarded Sandbox verification and coordinated integration before release.

## Remaining adapters

The package owns the GitHub environment allowlist; Deploy filters values as the package reads them to reject registered secrets and controls without enumerating the environment. Input credential types and result event-status/error types come from the packages. Base URLs are validated once by the appropriate shared validator. Shared sanitizers own secret encodings, bearer/header redaction, URL removal, text bounds and stack removal. Deploy retains HTML/JWT filtering and summary escaping because neither pinned package exports those protections.

Sandbox prerequisite OAuth, Management requests and polling sleep also use `ccv2-client`. The separate control API helper remains local: its run/scenario/cleanup operations use a control token with ordinary `Authorization`, not technical-user `x-approuter-authorization`. All ten scenarios, fixed origin, confirmation and always-run cleanup remain unchanged.

Lint rules prevent direct fetch in Action modules and Sandbox preparation, and direct Ajv imports in contract consumers. This keeps new transport and schema validation work routed through the shared packages. Small local adapters still translate transport errors into stable Deploy errors, count progress requests and enforce endpoint DTOs and unsafe-mutation policy.
