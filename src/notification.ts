import {
  createDeploymentEvent,
  extractSafeGitHubContext,
  type DeploymentEventData,
} from "@commercekit-tools/notification-contract";
import type { Result } from "./result.js";
import type { Sanitizer } from "./security.js";
import { controls } from "./inputs.js";
export function context(env: NodeJS.ProcessEnv, safe: Sanitizer) {
  const approved: NodeJS.ProcessEnv = {};
  for (const key of [
    "GITHUB_REPOSITORY",
    "GITHUB_REF",
    "GITHUB_SHA",
    "GITHUB_ACTOR",
    "GITHUB_WORKFLOW",
    "GITHUB_JOB",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_SERVER_URL",
  ]) {
    const value = env[key];
    if (value && !controls.test(value) && !safe.contains(value))
      approved[key] = value;
  }
  const ctx = extractSafeGitHubContext(approved);
  if (ctx.runUrl && safe.contains(ctx.runUrl)) delete ctx.runUrl;
  return ctx;
}
export function event(result: Result, env: NodeJS.ProcessEnv, safe: Sanitizer) {
  const data: DeploymentEventData = {};
  for (const key of [
    "subscriptionCode",
    "deploymentCode",
    "buildCode",
    "environmentCode",
    "databaseUpdateMode",
    "deploymentStatus",
    "durationMs",
  ] as const)
    if (
      result[key] !== undefined &&
      !(
        typeof result[key] === "string" &&
        ["databaseUpdateMode", "deploymentStatus"].includes(key) &&
        result[key].length > 100
      )
    )
      Object.assign(data, {
        [key]:
          typeof result[key] === "string"
            ? safe.text(result[key])
            : result[key],
      });
  if (result.error)
    data.error = {
      code: result.error.code,
      message: safe.error(result.error.message),
    };
  if (result.strategy && result.strategy.length <= 100)
    data.deploymentMode = result.strategy;
  if (result.decision) data.decisionType = result.decision;
  const ctx = context(env, safe);
  return createDeploymentEvent({
    status: result.outcome,
    data,
    context: ctx,
    ...(ctx.runUrl
      ? { links: [{ label: "View workflow", url: ctx.runUrl }] }
      : {}),
  });
}
