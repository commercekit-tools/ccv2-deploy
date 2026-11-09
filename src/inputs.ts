import { ActionError } from "./errors.js";
import type { Sanitizer } from "./security.js";
export const controls = /[\u0000-\u001f\u007f-\u009f]/;
export function textInput(
  value: string,
  name: string,
  max: number,
  optional = false,
) {
  if (
    (!optional && !value.trim()) ||
    value.length > max ||
    controls.test(value)
  )
    throw new ActionError("INVALID_INPUT", `Invalid ${name} input.`);
  return value;
}
export function httpsUrl(value: string): URL {
  try {
    if (value.length > 2048 || controls.test(value) || /[\s\\?#]/.test(value))
      throw Error();
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      !u.hostname ||
      u.username ||
      u.password ||
      u.hash ||
      u.search
    )
      throw Error();
    return u;
  } catch {
    throw new ActionError(
      "INVALID_INPUT",
      "A configured URL must be HTTPS without credentials, query, or fragment.",
    );
  }
}
export function segment(value: string): string {
  textInput(value, "path identifier", 128);
  if (/[/?#\\]/.test(value) || value === "." || value === "..")
    throw new ActionError("INVALID_INPUT", "Invalid path identifier.");
  return encodeURIComponent(value);
}
export type Operation = "deploy" | "resume" | "decide" | "cancel";
export type Decision = "ACCEPT" | "PREPARE_CANARY" | "REJECT";
export interface TrafficSplitRequest {
  endpoints?: { code: string; percentage: number }[];
  services?: { code: string; percentage: number }[];
}
export interface Inputs {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  resource: string;
  subscriptionCode: string;
  operation: Operation;
  deploymentCode?: string;
  buildCode?: string;
  environmentCode?: string;
  databaseUpdateMode?: string;
  strategy?: string;
  validateDeploymentModes: boolean;
  greenDecision: Decision | "MANUAL";
  decisionReason?: string;
  trafficSplit?: TrafficSplitRequest;
  rollbackDatabase: boolean;
  cancelReason?: string;
  apiBaseUrl: string;
  pollIntervalMs: number;
  timeoutMs: number;
}
const invalid = (name: string): never => {
  throw new ActionError(
    "INVALID_INPUT",
    `Invalid ${name} input or operation combination.`,
  );
};
export function trafficSplit(value: string): TrafficSplitRequest {
  try {
    if (Buffer.byteLength(value) > 32768) throw Error();
    const b: unknown = JSON.parse(value);
    if (!b || typeof b !== "object" || Array.isArray(b)) throw Error();
    const entries = Object.entries(b);
    if (
      !entries.length ||
      !entries.some(([, list]) => Array.isArray(list) && list.length > 0)
    )
      throw Error();
    for (const [key, list] of entries) {
      if (
        !["endpoints", "services"].includes(key) ||
        !Array.isArray(list) ||
        list.length > 50
      )
        throw Error();
      const codes = new Set();
      for (const item of list) {
        if (
          !item ||
          typeof item !== "object" ||
          Object.keys(item).sort().join(",") !== "code,percentage" ||
          typeof item.code !== "string" ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(item.code) ||
          codes.has(item.code) ||
          !Number.isInteger(item.percentage) ||
          item.percentage < 0 ||
          item.percentage > 100
        )
          throw Error();
        codes.add(item.code);
      }
    }
    return b as TrafficSplitRequest;
  } catch {
    throw new ActionError(
      "TRAFFIC_SPLIT_INVALID",
      "Invalid traffic-split-json input.",
    );
  }
}
export function readInputs(
  get: (name: string) => string,
  safe: Sanitizer,
): Inputs {
  const secrets: Record<string, string> = {};
  for (const name of [
    "token-endpoint",
    "client-id",
    "client-secret",
    "resource",
  ]) {
    const v = get(name);
    safe.add(v);
    secrets[name] = v;
  }
  for (const [k, v] of Object.entries(secrets))
    textInput(v, k, k === "client-secret" ? 8192 : 2048);
  const operation = get("operation") || "deploy";
  if (!["deploy", "resume", "decide", "cancel"].includes(operation))
    invalid("operation");
  const bool = (name: string, fallback: string) => {
    const v = get(name) || fallback;
    if (!["true", "false"].includes(v)) invalid(name);
    return v === "true";
  };
  const integer = (
    name: string,
    fallback: string,
    min: number,
    max: number,
  ) => {
    const v = get(name) || fallback;
    const n = Number(v);
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < min || n > max)
      invalid(name);
    return n;
  };
  const fields: Record<string, string> = {};
  for (const k of [
    "deployment-code",
    "build-code",
    "environment-code",
    "database-update-mode",
    "strategy",
  ])
    fields[k] = get(k);
  const deploy = operation === "deploy";
  for (const [k, v] of Object.entries(fields)) {
    const required = deploy ? k !== "deployment-code" : k === "deployment-code";
    if ((required && !v) || (!required && v)) invalid(k);
    if (v && k.endsWith("-code")) segment(v);
  }
  if (
    deploy &&
    !["NONE", "UPDATE", "INITIALIZE"].includes(fields["database-update-mode"]!)
  )
    invalid("database-update-mode");
  if (
    deploy &&
    !["ROLLING_UPDATE", "RECREATE", "GREEN"].includes(fields.strategy!)
  )
    invalid("strategy");
  const greenDecision = get("green-decision") || "MANUAL";
  if (
    !["MANUAL", "ACCEPT", "PREPARE_CANARY", "REJECT"].includes(greenDecision) ||
    (operation === "decide" && greenDecision === "MANUAL") ||
    (operation === "cancel" && greenDecision !== "MANUAL") ||
    (deploy && fields.strategy !== "GREEN" && greenDecision !== "MANUAL")
  )
    invalid("green-decision");
  const decisionReason = get("decision-reason");
  if (decisionReason && (greenDecision === "MANUAL" || operation === "cancel"))
    invalid("decision-reason");
  if (decisionReason) textInput(decisionReason, "decision-reason", 500);
  const split = get("traffic-split-json");
  if (split && greenDecision !== "PREPARE_CANARY")
    invalid("traffic-split-json");
  const rollbackDatabase = bool("rollback-database", "false");
  const cancelReason = get("cancel-reason");
  if (operation !== "cancel" && (rollbackDatabase || cancelReason))
    invalid("cancellation");
  if (cancelReason) {
    textInput(cancelReason, "cancel-reason", 255);
    if (cancelReason.length < 4) invalid("cancel-reason");
  }
  const validateDeploymentModes = bool("validate-deployment-modes", "true");
  if (!deploy && !validateDeploymentModes) invalid("validate-deployment-modes");
  if (
    !bool("wait-for-completion", "true") &&
    (operation !== "decide" || greenDecision !== "PREPARE_CANARY")
  )
    invalid("wait-for-completion");
  const subscriptionCode = get("subscription-code");
  segment(subscriptionCode);
  return {
    tokenEndpoint: httpsUrl(secrets["token-endpoint"]!).href,
    clientId: secrets["client-id"]!,
    clientSecret: secrets["client-secret"]!,
    resource: secrets.resource!,
    subscriptionCode,
    operation: operation as Operation,
    ...(deploy
      ? {
          buildCode: fields["build-code"]!,
          environmentCode: fields["environment-code"]!,
          databaseUpdateMode: fields["database-update-mode"]!,
          strategy: fields.strategy!,
        }
      : { deploymentCode: fields["deployment-code"]! }),
    validateDeploymentModes,
    greenDecision: greenDecision as Inputs["greenDecision"],
    ...(decisionReason ? { decisionReason } : {}),
    ...(split ? { trafficSplit: trafficSplit(split) } : {}),
    rollbackDatabase,
    ...(cancelReason ? { cancelReason } : {}),
    apiBaseUrl:
      httpsUrl(
        get("api-base-url") || "https://portalapi.commerce.ondemand.com",
      ).href.replace(/\/+$/, "") + "/",
    pollIntervalMs: integer("poll-interval-seconds", "60", 10, 600) * 1000,
    timeoutMs: integer("timeout-minutes", "240", 1, 1440) * 60000,
  };
}
