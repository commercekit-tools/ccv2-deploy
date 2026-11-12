import {
  createDeploymentEvent,
  extractSafeGitHubContext,
  type DeploymentEventData,
} from "@commercekit-tools/notification-contract";
import type { Result } from "./result.js";
import type { Sanitizer } from "./security.js";
import { controls } from "./inputs.js";
export function context(env: NodeJS.ProcessEnv, safe: Sanitizer) {
  // The package owns the environment allowlist. Filter only values it reads,
  // retaining Deploy's stricter rejection of controls and registered secrets.
  const ctx = extractSafeGitHubContext(
    new Proxy(env, {
      get(target, key: string) {
        const value = target[key];
        return value && !controls.test(value) && !safe.contains(value)
          ? value
          : undefined;
      },
    }),
  );
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
