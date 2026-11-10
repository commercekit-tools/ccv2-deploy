# API contract and provenance

Reviewed SAP Management API **2.0.12**, independently authored Sandbox Management **2.0.12-sandbox.1**, and Sandbox Control **1.0.0**. Production authority is [SAP Cloud Portal API documentation](https://help.sap.com/docs/SAP_COMMERCE_CLOUD_PUBLIC_CLOUD/0fa6bcf4736c46f78c248512391eb467/66abfe678b55457fab235ce8039dda71.html?locale=en-US). Its direct HTML is client-rendered; indexed official documentation exposes the schema and operation descriptions. No SAP-authored OpenAPI is distributed.

Compatibility sources are Sandbox main commit `a787e4b07c487a8a4833541f7f7d8bd4afd9fef4`: ccv2 README, authentication, coverage, scenarios, contract-audit, production-readiness, website-integration, both OpenAPI documents, and deployment handlers. Read-only downloads of the live `/openapi.json` and `/openapi/sandbox.json` were inspected. Build conventions come from public PR #1 at `c713930b339ab132a831569bac7c2fecf9dccd4c`; notify schema provenance is committed separately. Other repositories were not changed.

Paths below are relative to `/v2/subscriptions/{subscriptionCode}`:

| Operation                        | Method/path                                 | Response                                                                    | Usage                                                |
| -------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| getDeploymentModes               | GET deploymentmodes                         | 200 array of environment/mode objects                                       | Preflight                                            |
| createDeployment                 | POST deployments                            | 201 code, optional subscriptionCode                                         | Implemented                                          |
| getDeployments                   | GET deployments                             | 200 paginated collection                                                    | Reviewed, unnecessary for execution                  |
| getDeployment                    | GET deployments/{code}                      | 200 detail                                                                  | Implemented                                          |
| getDeploymentProgress            | GET deployments/{code}/progress             | 200 progress                                                                | Implemented                                          |
| getDeploymentDecisions           | GET deployments/{code}/decisions            | 200 deploymentDecisions history                                             | Implemented                                          |
| createDeploymentDecision         | POST deployments/{code}/decisions           | 201 decision, optional newDeploymentCode; operation page also describes 200 | Implemented; both accepted                           |
| getDeploymentCancellationOptions | GET deployments/{code}/cancellationoptions  | 200 options; 404 unavailable; 501 disabled                                  | Implemented                                          |
| createDeploymentCancellation     | POST deployments/{code}/cancellation        | 202; can be bodyless                                                        | Implemented                                          |
| getTrafficSplit                  | GET deployments/{code}/trafficsplit         | 200 detail                                                                  | Reviewed; not needed after validated update response |
| updateTrafficSplit               | PUT deployments/{code}/trafficsplit         | 201 detail                                                                  | Implemented; accepts 200 compatibility response too  |
| getTrafficSplitHistory           | GET deployments/{code}/trafficsplit/history | 200 value/count history                                                     | Reviewed; not called or exposed                      |

Creation sends only buildCode, environmentCode, databaseUpdateMode (NONE/UPDATE/INITIALIZE), and strategy (ROLLING_UPDATE/RECREATE/GREEN). Preflight selects exact environmentCode and validates deploymentModes.dataMigrationMode and deploymentModes.deploymentMode. No replacement mode is chosen. Unknown/malformed modes fail before creation.

Detail/progress use SCHEDULED, DEPLOYING, DEPLOYED, UNDEPLOYED, FAIL. Unknown statuses are preserved in safe output and treated as internal errors. Optional percentage must be an integer 0–100. Decisions send decision and optional reason; the deprecated response field `decison` is normalized internally. Cancellation sends rollbackDatabase and optional cancelReason. Official cancelReason is 4–255 characters; this stricter production limit overrides Sandbox's wider acceptance. Rollback requires a parseable databaseRollbackRestoreTimestamp.

Traffic split requests contain endpoints/services arrays of code/percentage, no additional fields, at most 50 entries each and at least one entry overall. Codes use a conservative 100-character token subset, rejecting URL/credential syntax and duplicates. Percentages are integers 0–100. Response entity names and metadata are ignored and never exposed.

Documented error responses include 400, 401, 403, 404, 409, 412, 423 and 5xx, plus throttling 429. Errors are normalized to stable operation codes and HTTP status messages. Untrusted problem title/detail are intentionally not echoed, even after secret masking. Mutation response loss or invalid confirmation remains ambiguous and is never replayed. Safe reads and OAuth have three total attempts; explicit 401 permits one token refresh retry.

## Decision-point inference and limits

The official model describes a decision expiry and canary state, but does not define a dedicated ready-for-decision boolean. The conservative client predicate requires DEPLOYING in detail and progress, a future valid expireAtTimestamp, isCanaryAvailable=true, canaryStatus STARTED or SUCCEEDED, and history without ACCEPT/REJECT. Sandbox sets STARTED when pausing; creation already has expiry/availability, so those fields alone are insufficient. Percentage 90 is never used as the sole trigger. Sandbox-only awaitingDecision is deliberately not required.

This predicate is an inference from documented fields and verified against the current Sandbox implementation. A production response lacking this evidence continues polling rather than submitting speculatively; API validation remains authoritative. No claim of live SAP validation is made. An existing PREPARE_CANARY history allows later ACCEPT/REJECT; the Action submits at most one decision per invocation.

Polling defaults (60 seconds, minimum 10) are conservative Action policy, not an SAP-prescribed interval. There is no verified UI deep link, so events link only to workflow runs. Legacy static API-token authentication, embedded notification rendering, and legacy status assumptions are not carried forward.
