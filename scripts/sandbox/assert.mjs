import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import * as core from "@actions/core";
import { credentials, request, scenarios } from "./common.mjs";
try {
  const run = credentials();
  const scenario = process.env.SCENARIO;
  assert(scenarios.includes(scenario));
  const raw = process.env.RESULT_JSON;
  const rawEvent = process.env.NOTIFICATION_EVENT;
  assert(raw && rawEvent);
  for (const key of [
    "CONTROL_TOKEN",
    "CLIENT_ID",
    "CLIENT_SECRET",
    "RESOURCE",
    "TOKEN_ENDPOINT",
  ]) {
    const value = process.env[key];
    assert(value);
    assert(!raw.includes(value) && !rawEvent.includes(value));
  }
  const result = JSON.parse(raw);
  const event = JSON.parse(rawEvent);
  const ajv = new Ajv2020({ strict: false });
  formats(ajv);
  assert(
    ajv.validate(
      JSON.parse(
        readFileSync("contracts/notification-event-v1.schema.json", "utf8"),
      ),
      event,
    ),
  );
  const expected = {
    "rolling-success": "success",
    "rolling-failure": "failure",
    nonterminating: "internal-error",
    "rate-limit": "success",
    "create-error": "internal-error",
    "green-manual": "action-required",
    "green-accept": "success",
    "green-prepare-canary": "action-required",
    "green-reject": "cancelled",
    cancel: "cancelled",
  }[scenario];
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.outcome, expected);
  assert.equal(event.status, expected);
  assert.equal(
    event.eventType,
    expected === "action-required"
      ? "ccv2.deployment.action-required"
      : "ccv2.deployment.completed",
  );
  assert.equal(
    process.env.ACTION_OUTCOME,
    ["success", "action-required"].includes(expected) ? "success" : "failure",
  );
  assert.equal(process.env.DURATION_MS, String(result.durationMs));
  assert.equal(process.env.POLL_COUNT, String(result.pollCount));
  assert.equal(process.env.DEPLOYMENT_STATUS, result.deploymentStatus ?? "");
  const state = await request(
    `/sandbox/v1/runs/${run}/state`,
    "GET",
    process.env.CONTROL_TOKEN,
  );
  assert.equal(state.counts.builds, 1);
  if (scenario === "create-error") {
    assert.equal(result.error.code, "CREATE_DEPLOYMENT_AMBIGUOUS");
    assert.equal(state.counts.deployments, 0);
    assert.equal(state.faultCounters["createDeployment:"], 1);
  } else {
    assert.equal(state.counts.deployments, 1);
    assert(result.deploymentCode);
    assert.equal(
      result.deploymentStatus,
      expected === "success"
        ? "DEPLOYED"
        : expected === "failure"
          ? "FAIL"
          : expected === "cancelled"
            ? "UNDEPLOYED"
            : "DEPLOYING",
    );
  }
  if (scenario === "nonterminating") {
    assert(result.timedOut);
    assert.equal(result.error.code, "DEPLOYMENT_WAIT_TIMEOUT");
  }
  if (scenario === "green-manual") assert.equal(result.actionRequired, true);
  if (scenario === "green-accept") assert.equal(result.decision, "ACCEPT");
  if (scenario === "green-reject") assert.equal(result.decision, "REJECT");
  if (scenario === "green-prepare-canary") {
    assert.equal(result.decision, "PREPARE_CANARY");
    assert(result.newDeploymentCode);
    assert(result.trafficSplit.updated);
    assert(result.actionRequired);
  }
  if (scenario === "cancel") assert(result.cancellation.requested);
  if (scenario === "rate-limit") assert(result.pollCount >= 3);
  core.info("Sandbox output and state assertions passed.");
} catch {
  core.setFailed("Sandbox output or state assertions failed.");
}
