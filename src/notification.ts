import { randomUUID } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import { default as formats } from "ajv-formats";
import schema from "../contracts/notification-event-v1.schema.json" with { type: "json" };
import type { Result } from "./result.js";
import { httpsUrl, controls } from "./inputs.js";
import type { Sanitizer } from "./security.js";
const ajv = new Ajv2020({ strict: false });
(formats as unknown as (a: Ajv2020) => void)(ajv);
export const validateEvent = ajv.compile(schema);
export function context(env: NodeJS.ProcessEnv, safe: Sanitizer) {
  const ctx: Record<string, string | number> = {};
  for (const [name, key, max] of [
    ["repository", "GITHUB_REPOSITORY", 200],
    ["ref", "GITHUB_REF", 300],
    ["commit", "GITHUB_SHA", 128],
    ["actor", "GITHUB_ACTOR", 128],
    ["workflow", "GITHUB_WORKFLOW", 200],
    ["job", "GITHUB_JOB", 200],
    ["runId", "GITHUB_RUN_ID", 64],
  ] as const) {
    const v = env[key];
    if (v && !controls.test(v) && v.length <= max && !safe.contains(v))
      ctx[name] = v;
  }
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (Number.isSafeInteger(attempt) && attempt >= 1) ctx.runAttempt = attempt;
  try {
    const server = httpsUrl(env.GITHUB_SERVER_URL ?? "https://github.com");
    const repo = ctx.repository;
    const id = ctx.runId;
    if (
      typeof repo === "string" &&
      /^[\w.-]+\/[\w.-]+$/.test(repo) &&
      typeof id === "string" &&
      /^\d+$/.test(id)
    ) {
      const url = new URL(
        `${repo}/actions/runs/${id}`,
        server.href.replace(/\/?$/, "/"),
      ).href;
      if (url.length <= 2048 && !safe.contains(url)) ctx.runUrl = url;
    }
  } catch {
    /* Omit unsafe or unavailable GitHub URL. */
  }
  return ctx;
}
export function event(result: Result, env: NodeJS.ProcessEnv, safe: Sanitizer) {
  const data: Record<string, unknown> = {};
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
      data[key] = result[key];
  if (result.error)
    data.error = { code: result.error.code, message: result.error.message };
  if (result.strategy && result.strategy.length <= 100)
    data.deploymentMode = result.strategy;
  if (result.decision) data.decisionType = result.decision;
  const ctx = context(env, safe);
  const value = {
    schemaVersion: 1,
    eventId: `ckevt_${randomUUID()}`,
    eventType:
      result.actionRequired && result.outcome === "action-required"
        ? "ccv2.deployment.action-required"
        : "ccv2.deployment.completed",
    status: result.outcome,
    occurredAt: new Date().toISOString(),
    source: { product: "commercekit", component: "ccv2-deploy" },
    data,
    context: ctx,
    ...(ctx.runUrl
      ? { links: [{ label: "View workflow", url: ctx.runUrl }] }
      : {}),
  };
  if (!validateEvent(value))
    throw new Error("Generated notification failed schema validation.");
  return value;
}
