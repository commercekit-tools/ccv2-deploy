import * as core from "@actions/core";
import { base, scenarios, request } from "./common.mjs";
try {
  const scenario = process.env.SCENARIO;
  if (
    process.env.CONFIRMATION !== "RUN-COMMERCEKIT-SANDBOX-DEPLOY" ||
    !scenarios.includes(scenario)
  )
    throw Error("Sandbox confirmation or scenario is invalid.");
  const run = await request("/sandbox/v1/runs", "POST");
  const c = run.credentials;
  for (const value of [
    run.controlToken,
    c.clientId,
    c.clientSecret,
    c.resource,
    c.tokenUrl,
  ])
    core.setSecret(value);
  // Publish cleanup credentials before scenario configuration can fail.
  core.setOutput("run-id", run.runId);
  core.setOutput("control-token", run.controlToken);
  if (
    !/^run_[0-9a-f]{32}$/.test(run.runId) ||
    c.tokenUrl !== base + "/oauth2/token"
  )
    throw Error("Unexpected Sandbox credential response.");
  for (const [name, value] of Object.entries({
    "token-endpoint": c.tokenUrl,
    "client-id": c.clientId,
    "client-secret": c.clientSecret,
    resource: c.resource,
    "subscription-code": "131762872233634f29fdeb7d50983aa4",
  }))
    core.setOutput(name, value);
  const faults =
    scenario === "rate-limit"
      ? [
          {
            operationId: "getDeploymentProgress",
            status: 429,
            onCalls: [1],
            retryAfterSeconds: 1,
          },
        ]
      : scenario === "create-error"
        ? [{ operationId: "createDeployment", status: 500, onCalls: [1] }]
        : [];
  await request(
    `/sandbox/v1/runs/${run.runId}/scenario`,
    "PUT",
    run.controlToken,
    {
      build: {
        outcome: "SUCCESS",
        pollsBeforeTerminal: 1,
        logsAvailable: true,
      },
      deployment: {
        outcome:
          scenario === "rolling-failure"
            ? "FAIL"
            : scenario === "nonterminating" || scenario === "cancel"
              ? "NEVER"
              : "DEPLOYED",
        pollsBeforeTerminal: 1,
        cancellationAllowed: true,
        requireGreenDecision: scenario.startsWith("green-"),
      },
      faults,
    },
  );
  const tokenResponse = await fetch(base + "/oauth2/token", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      resource: c.resource,
      grant_type: "client_credentials",
    }),
  });
  if (!tokenResponse.ok) throw Error("Synthetic authentication failed");
  const token = (await tokenResponse.json()).access_token;
  if (typeof token !== "string" || !token) throw Error();
  core.setSecret(token);
  const prefix = "/v2/subscriptions/131762872233634f29fdeb7d50983aa4";
  async function management(path, method = "GET", body) {
    const response = await fetch(base + prefix + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Accept: "application/json",
        "x-approuter-authorization": `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw Error("Synthetic prerequisite request failed");
    return response.json();
  }
  const build = await management("/builds", "POST", {
    branch: "main",
    name: "synthetic-deploy-prerequisite",
    applicationCode: "commerce",
  });
  if (typeof build.code !== "string" || !/^\d{8}\.\d+$/.test(build.code))
    throw Error();
  let built = false;
  for (let i = 0; i < 6; i++) {
    const progress = await management(
      "/builds/" + encodeURIComponent(build.code) + "/progress",
    );
    if (progress.buildStatus === "SUCCESS") {
      built = true;
      break;
    }
    if (progress.buildStatus === "FAIL") throw Error();
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  if (!built) throw Error("Prerequisite build timed out");
  const environments = await management("/environments");
  const environment = environments.value?.[0]?.code;
  if (
    typeof environment !== "string" ||
    !/^(?!\.\.?$)[a-zA-Z0-9_-]{1,100}$/.test(environment)
  )
    throw Error();
  const green = scenario.startsWith("green-");
  const strategy = green ? "GREEN" : "ROLLING_UPDATE";
  const decision =
    {
      "green-accept": "ACCEPT",
      "green-prepare-canary": "PREPARE_CANARY",
      "green-reject": "REJECT",
    }[scenario] ?? "MANUAL";
  core.setOutput("operation", scenario === "cancel" ? "cancel" : "deploy");
  core.setOutput("green-decision", decision);
  if (scenario === "cancel") {
    const deployment = await management("/deployments", "POST", {
      buildCode: build.code,
      environmentCode: environment,
      databaseUpdateMode: "NONE",
      strategy,
    });
    if (typeof deployment.code !== "string" || !/^\d+$/.test(deployment.code))
      throw Error();
    core.setOutput("deployment-code", deployment.code);
  } else {
    core.setOutput("build-code", build.code);
    core.setOutput("environment-code", environment);
    core.setOutput("strategy", strategy);
    core.setOutput("database-update-mode", "NONE");
  }
  if (scenario === "green-prepare-canary")
    core.setOutput(
      "traffic-split-json",
      JSON.stringify({ services: [{ code: "commerce", percentage: 10 }] }),
    );
} catch {
  core.setFailed(
    "Sandbox preparation failed. Inspect confirmation and Sandbox availability.",
  );
}
