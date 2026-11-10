import * as core from "@actions/core";
export const base = "https://ccv2.sandbox.commercekit.tools";
export const scenarios = [
  "rolling-success",
  "rolling-failure",
  "nonterminating",
  "rate-limit",
  "create-error",
  "green-manual",
  "green-accept",
  "green-prepare-canary",
  "green-reject",
  "cancel",
];
export async function request(path, method = "GET", token, body) {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw Error(`Sandbox ${method} failed (HTTP ${response.status}).`);
  return response.status === 204 ? undefined : response.json();
}
export function credentials() {
  for (const key of [
    "CONTROL_TOKEN",
    "CLIENT_ID",
    "CLIENT_SECRET",
    "RESOURCE",
    "TOKEN_ENDPOINT",
  ])
    if (process.env[key]) core.setSecret(process.env[key]);
  const run = process.env.RUN_ID;
  if (!/^run_[0-9a-f]{32}$/.test(run ?? ""))
    throw Error("Invalid Sandbox run ID.");
  if (!process.env.CONTROL_TOKEN) throw Error("Missing Sandbox control token.");
  return run;
}
