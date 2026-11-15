import {
  createActionInputContext,
  renderActionSummary,
  type ActionInputDefinition,
  type NotificationInputContext,
  type SafeNotificationError,
} from "@commercekit-tools/notification-contract";
import type { Inputs } from "./inputs.js";
import type { Result } from "./result.js";
import type { Sanitizer } from "./security.js";
import { context } from "./notification.js";

export const inputDefinitions: readonly ActionInputDefinition[] = [
  { name: "operation" },
  { name: "token-endpoint", confidential: true },
  { name: "client-id", confidential: true },
  { name: "client-secret", confidential: true },
  { name: "resource", confidential: true },
  { name: "subscription-code" },
  { name: "deployment-code" },
  { name: "build-code" },
  { name: "environment-code" },
  { name: "database-update-mode" },
  { name: "strategy" },
  { name: "validate-deployment-modes" },
  { name: "green-decision" },
  { name: "decision-reason", display: "presence" },
  { name: "traffic-split-json", display: "presence" },
  { name: "rollback-database" },
  { name: "cancel-reason", display: "presence" },
  { name: "wait-for-completion" },
  { name: "api-base-url", display: "url-origin" },
  { name: "poll-interval-seconds" },
  { name: "timeout-minutes" },
];

export function inputContext(
  raw: Readonly<Record<string, string>>,
  input: Inputs | undefined,
  safe: Sanitizer,
): NotificationInputContext {
  return createActionInputContext(inputDefinitions, raw, {
    validated: input !== undefined,
    secrets: safe.knownSecrets(),
    ...(input
      ? {
          effective: {
            operation: input.operation,
            "subscription-code": input.subscriptionCode,
            "deployment-code": input.deploymentCode ?? "",
            "build-code": input.buildCode ?? "",
            "environment-code": input.environmentCode ?? "",
            "database-update-mode": input.databaseUpdateMode ?? "",
            strategy: input.strategy ?? "",
            "validate-deployment-modes": String(input.validateDeploymentModes),
            "green-decision": input.greenDecision,
            "decision-reason": input.decisionReason ?? "",
            "traffic-split-json": input.trafficSplit ? "provided" : "",
            "rollback-database": String(input.rollbackDatabase),
            "cancel-reason": input.cancelReason ?? "",
            "wait-for-completion": raw["wait-for-completion"] || "true",
            "api-base-url": input.apiBaseUrl,
            "poll-interval-seconds": String(input.pollIntervalMs / 1000),
            "timeout-minutes": String(input.timeoutMs / 60000),
          },
        }
      : {}),
  });
}

export function summary(
  result: Result,
  safe: Sanitizer,
  env: NodeJS.ProcessEnv,
  reportingIssues: readonly SafeNotificationError[] = [],
): string {
  const ctx = context(env, safe);
  const facts = [
    ["Operation", result.operation],
    ["Deployment status", result.deploymentStatus],
    ["Subscription", result.subscriptionCode],
    ["Deployment code", result.deploymentCode],
    ["Original deployment code", result.originalDeploymentCode],
    ["Build code", result.buildCode],
    ["Environment", result.environmentCode],
    ["Database update", result.databaseUpdateMode],
    ["Strategy", result.strategy],
    ["Decision", result.decision],
    ["Progress (%)", result.percentage],
    ["Poll count", result.pollCount],
    ["Duration (ms)", result.durationMs],
    ["Action required", result.actionRequired],
    ["Timed out", result.timedOut],
    ["Cancellation requested", result.cancellation?.requested],
    ["Rollback database", result.cancellation?.rollbackDatabase],
    ["Traffic split updated", result.trafficSplit?.updated],
  ] as const;
  return renderActionSummary({
    title: "CCv2 Deploy",
    status: result.outcome,
    facts: facts.flatMap(([label, value]) =>
      value === undefined ? [] : [{ label, value }],
    ),
    ...(result.inputs
      ? {
          inputContext: {
            inputs: result.inputs,
            inputsValidated: result.inputsValidated ?? false,
            inputsTruncated: result.inputsTruncated ?? false,
          },
        }
      : {}),
    ...(result.error ? { error: result.error } : {}),
    issues: [...(result.issues ?? []), ...reportingIssues].slice(0, 3),
    ...(ctx.runUrl
      ? { links: [{ label: "View workflow", url: ctx.runUrl }] }
      : {}),
    secrets: safe.knownSecrets(),
  });
}
