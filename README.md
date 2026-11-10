# CommerceKit CCv2 Deploy

**UNRELEASED. No v1 tag exists.** Deploy existing SAP Commerce Cloud builds using Cloud Portal technical-user OAuth and provider-neutral NotificationEvent v1 outputs. Build creation is not a public feature.

## Authentication

Create or edit a Cloud Portal technical user, grant the environment access and deployment permissions your workflow needs, create a client secret, and collect its token endpoint, client ID, client secret, and resource. Follow [SAP documentation](https://help.sap.com/docs/SAP_COMMERCE_CLOUD_PUBLIC_CLOUD/0fa6bcf4736c46f78c248512391eb467/66abfe678b55457fab235ce8039dda71.html?locale=en-US); permission names depend on the portal configuration.

Store all four values in GitHub secrets: `CCV2_TOKEN_ENDPOINT`, `CCV2_CLIENT_ID`, `CCV2_CLIENT_SECRET`, `CCV2_RESOURCE`. Store `CCV2_SUBSCRIPTION_CODE` and `CCV2_ENVIRONMENT_CODE` as variables or secrets according to your policy. Resource is not an OAuth scope. Tokens remain in memory and refresh before expiry or once after explicit 401.

## Operations

| Operation | Required lifecycle inputs                                    | Calls                                                | Completion                             |
| --------- | ------------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------- |
| deploy    | build-code, environment-code, database-update-mode, strategy | modes, create, detail, progress                      | Terminal or green handoff              |
| resume    | deployment-code                                              | detail, progress                                     | Terminal or green handoff              |
| decide    | deployment-code, non-MANUAL green-decision                   | detail, progress, history, decision; optional split  | ACCEPT/REJECT terminal; canary handoff |
| cancel    | deployment-code                                              | detail, cancellation options, cancellation, progress | Terminal                               |

Create fields are forbidden on existing-deployment operations. Deployment code is forbidden on deploy. Reasons cannot accompany MANUAL. Cancellation settings are forbidden outside cancel. Nondefault mode-validation settings are forbidden outside deploy. Explicit default boolean values are accepted because GitHub supplies metadata defaults.

## Inputs

All identifiers are nonempty, bounded to 128 characters, reject controls/path separators/query/fragment, and are encoded as path segments when used in URLs. Secrets are masked before validation. URLs require HTTPS and reject credentials, query, fragment, whitespace, and controls. Unknown enum values and inappropriate input combinations fail.

| Input                       | Default                                 | Sensitive | Purpose and validation                                                                               |
| --------------------------- | --------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `operation`                 | deploy                                  | No        | deploy, resume, decide, or cancel.                                                                   |
| `token-endpoint`            | None                                    | Yes       | Technical-user HTTPS OAuth token endpoint.                                                           |
| `client-id`                 | None                                    | Yes       | Technical-user OAuth client ID.                                                                      |
| `client-secret`             | None                                    | Yes       | Technical-user OAuth client secret.                                                                  |
| `resource`                  | None                                    | Yes       | OAuth resource, not scope.                                                                           |
| `subscription-code`         | None                                    | No        | Subscription path identifier.                                                                        |
| `deployment-code`           | None                                    | No        | Existing deployment; required for resume, decide, cancel; forbidden for deploy.                      |
| `build-code`                | None                                    | No        | Existing build; required only for deploy.                                                            |
| `environment-code`          | None                                    | No        | Target environment; required only for deploy.                                                        |
| `database-update-mode`      | None                                    | No        | Explicit NONE, UPDATE, or INITIALIZE; required only for deploy.                                      |
| `strategy`                  | None                                    | No        | Explicit ROLLING_UPDATE, RECREATE, or GREEN; required only for deploy.                               |
| `validate-deployment-modes` | true                                    | No        | Preflight deployment modes; false is valid only for deploy.                                          |
| `green-decision`            | MANUAL                                  | No        | MANUAL, ACCEPT, PREPARE_CANARY, or REJECT; decide requires a non-MANUAL decision.                    |
| `decision-reason`           | None                                    | No        | Optional decision reason, at most 500 characters; invalid with MANUAL.                               |
| `traffic-split-json`        | None                                    | No        | PREPARE_CANARY only; at most 32 KiB, endpoints/services, 50 entries each, integer percentages 0–100. |
| `rollback-database`         | false                                   | No        | Cancellation only; requires available database rollback timestamp.                                   |
| `cancel-reason`             | None                                    | No        | Cancellation only; optional reason of 4–255 characters.                                              |
| `wait-for-completion`       | true                                    | No        | Must be true except for decide PREPARE_CANARY, which always hands off.                               |
| `api-base-url`              | https://portalapi.commerce.ondemand.com | No        | HTTPS Management API base URL without credentials, query, or fragment.                               |
| `poll-interval-seconds`     | 60                                      | No        | Integer from 10 to 600 seconds.                                                                      |
| `timeout-minutes`           | 240                                     | No        | Local operation deadline, integer from 1 to 1440 minutes.                                            |

## Outputs

All outputs are strings. Optional unknown values are empty.

| Output                     | Meaning                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `operation`                | Validated operation.                                            |
| `deployment-code`          | Current active deployment code, updated from decision response. |
| `original-deployment-code` | Originally created or supplied deployment code.                 |
| `build-code`               | Input or recovered build code.                                  |
| `environment-code`         | Input or recovered environment code.                            |
| `deployment-status`        | Last known vendor status; never ACTION_REQUIRED or TIMEOUT.     |
| `deployment-percentage`    | Last valid API percentage; empty until known.                   |
| `action-required`          | true for manual/canary handoff, otherwise false.                |
| `decision`                 | Submitted and accepted decision, or empty.                      |
| `poll-count`               | Number of progress HTTP attempts, including retries.            |
| `duration-ms`              | Full monotonic operation duration.                              |
| `result-json`              | Bounded sanitized schemaVersion 1 result.                       |
| `notification-event`       | Validated provider-neutral NotificationEvent v1.                |

## Deploy and notify — after v1 is published

These references are future coordinated-release examples, not currently published deploy/build versions. Pin reviewed commit SHAs before release.

```yaml
- name: Build CCv2 release
  id: build
  uses: commercekit-tools/ccv2-build@v1
  with:
    token-endpoint: ${{ secrets.CCV2_TOKEN_ENDPOINT }}
    client-id: ${{ secrets.CCV2_CLIENT_ID }}
    client-secret: ${{ secrets.CCV2_CLIENT_SECRET }}
    resource: ${{ secrets.CCV2_RESOURCE }}
    subscription-code: ${{ vars.CCV2_SUBSCRIPTION_CODE }}
    branch: main
    build-name: release-${{ github.run_id }}
- name: Deploy CCv2 build
  id: deploy
  uses: commercekit-tools/ccv2-deploy@v1
  with:
    token-endpoint: ${{ secrets.CCV2_TOKEN_ENDPOINT }}
    client-id: ${{ secrets.CCV2_CLIENT_ID }}
    client-secret: ${{ secrets.CCV2_CLIENT_SECRET }}
    resource: ${{ secrets.CCV2_RESOURCE }}
    subscription-code: ${{ vars.CCV2_SUBSCRIPTION_CODE }}
    build-code: ${{ steps.build.outputs.build-code }}
    environment-code: ${{ vars.CCV2_ENVIRONMENT_CODE }}
    database-update-mode: UPDATE
    strategy: ROLLING_UPDATE
- name: Notify deployment result
  if: ${{ always() && steps.deploy.outputs.notification-event != '' }}
  uses: commercekit-tools/notify@v1
  with:
    provider: slack
    event-json: ${{ steps.deploy.outputs.notification-event }}
    webhook-url: ${{ secrets.COMMERCEKIT_SLACK_WEBHOOK_URL }}
```

Deploy itself has no provider or webhook configuration.

## Green and canary workflows

Deploy with `strategy: GREEN` and `green-decision: MANUAL`. At a verified decision point the Action returns successfully with `action-required: true`, the actual vendor status, and `ccv2.deployment.action-required`. This is a handoff, not completed deployment.

Pass `deployment-code` to a later job protected by a GitHub environment approval. Invoke this Action with common credentials, `operation: decide`, that deployment code, and `green-decision: ACCEPT`, `PREPARE_CANARY`, or `REJECT`. Do not pass create inputs to this step. The approval and notification do not themselves submit a decision.

PREPARE_CANARY captures any new deployment code, optionally updates a validated split, and returns action-required. Example additional inputs:

```yaml
operation: decide
deployment-code: ${{ needs.prepare.outputs.deployment-code }}
green-decision: PREPARE_CANARY
traffic-split-json: '{"endpoints":[{"code":"synthetic-storefront","percentage":10}]}'
```

Replace the synthetic code with an actual allowed entity through your own reviewed configuration. The split is never output. Later invoke decide ACCEPT or REJECT against the returned current deployment code. ACCEPT and REJECT require `wait-for-completion: true` in v1 to ensure a truthful final event. PREPARE_CANARY never claims final completion.

## Cancellation

Use common credentials plus `operation: cancel`, `deployment-code`, optional `rollback-database: true`, and optional `cancel-reason` (4–255 characters). The Action checks cancellation options first. HTTP 404 means unavailable; 501 means disabled. Rollback requires a valid restoration timestamp. Accepted cancellation is monitored to terminal status.

## Waiting, failure, and retry safety

SCHEDULED and DEPLOYING continue polling. DEPLOYED succeeds, FAIL fails, UNDEPLOYED emits cancelled and fails the step, including explicit cancel/REJECT operations. Unknown statuses are preserved and produce internal-error. Use `if: always()` for later notification and cleanup; there is no failure-suppression input.

`timeout-minutes` bounds local waiting and requests. It does not stop or roll back remote deployment. Timeout preserves status and percentage, emits internal-error with DEPLOYMENT_WAIT_TIMEOUT, and fails. Runner signals abort local requests; hard runner termination can prevent outputs. There is no automatic remote cancellation.

Safe reads and token requests retry selected transient errors at most three attempts with jitter and Retry-After. Mutations (create, decision, cancellation, split) are never replayed after ambiguous network, timeout, malformed response, 429 or 5xx. Only an explicit 401 allows one refresh/retry. Inspect Cloud Portal before retrying ambiguous operations. Disabling mode preflight cannot make an unsupported mode valid in SAP.

## Result and events

`result-json` is a compact allowlisted schemaVersion 1 object containing operation, outcome, known deployment/build/environment identifiers, modes, last vendor status/percentage, poll count, duration, actionRequired, decision, newDeploymentCode, timedOut, cancellation requested/rollback flags, trafficSplit updated flag, and safe error code/message. Unknown optional fields are omitted. Each JSON output is bounded to 16 KiB. No raw responses, stage/history data, reasons, credentials, or traffic entities are output.

DEPLOYED → success; FAIL → failure; UNDEPLOYED → cancelled; manual/canary handoff → action-required; timeout, auth/API/client errors or undocumented status → internal-error. Handoffs emit `ccv2.deployment.action-required`; all other final events emit `ccv2.deployment.completed`. Events validate offline through the pinned [shared notification contract](contracts/README.md). Only approved GitHub context variables are read. Links include a validated workflow URL; no Cloud Portal URL is guessed.

See [API contract](docs/api-contract.md), [Sandbox](docs/sandbox.md), [security](SECURITY.md), [contributing](CONTRIBUTING.md), and [release gates](RELEASING.md).

## Shared packages

Exact runtime pins are `@commercekit-tools/notification-contract@0.0.2` and `@commercekit-tools/ccv2-client@0.0.2`. The former owns NotificationEvent v1 types, deployment event creation, validation, context, links, and event text sanitization. The latter provides framework-independent technical-user OAuth and CCv2 HTTP transport, including token refresh, URL validation, timeouts, redaction, and safe-read/unsafe-mutation policies.

Deploy retains inputs, endpoint DTO validation, mode preflight, the deployment lifecycle, green decisions, traffic split, cancellation, results, outputs, and summaries. Both packages are bundled into `dist`; workflow users need no registry configuration or package credentials. Maintainers and CI need GitHub Packages read access. Package upgrades require the full deployment regression suite and guarded Sandbox verification before release. See the [ownership inventory](docs/shared-packages.md). The Action remains **UNRELEASED**.
