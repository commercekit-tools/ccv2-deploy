import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import schema from "@commercekit-tools/notification-contract/schema" with { type: "json" };
import {
  createDeploymentEvent,
  validateNotificationEvent,
} from "@commercekit-tools/notification-contract";
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
for (const name of [
  "@commercekit-tools/notification-contract",
  "@commercekit-tools/ccv2-client",
]) {
  assert.equal(manifest.dependencies[name], "0.0.2");
  assert.equal(require(`${name}/package.json`).version, "0.0.2");
}
assert.equal(schema.properties.schemaVersion.const, 1);
for (const file of [
  "contracts/notification-event-v1.schema.json",
  "contracts/notify-provenance.json",
  "scripts/update-notify.mjs",
  "src/auth.ts",
  "src/http.ts",
])
  assert(!existsSync(file), `Duplicate shared implementation: ${file}`);
for (const status of [
  "success",
  "failure",
  "cancelled",
  "action-required",
  "internal-error",
]) {
  const event = createDeploymentEvent({
    status,
    data: {
      subscriptionCode: "synthetic-subscription",
      deploymentCode: "synthetic-deployment",
      buildCode: "synthetic-build",
      environmentCode: "synthetic-environment",
      deploymentMode: "GREEN",
      databaseUpdateMode: "NONE",
      durationMs: 100,
      deploymentStatus:
        status === "success"
          ? "DEPLOYED"
          : status === "failure"
            ? "FAIL"
            : status === "cancelled"
              ? "UNDEPLOYED"
              : "DEPLOYING",
      ...(status === "action-required"
        ? { decisionType: "PREPARE_CANARY" }
        : {}),
      ...(["failure", "cancelled", "internal-error"].includes(status)
        ? { error: { code: "SYNTHETIC_ERROR", message: "Synthetic failure." } }
        : {}),
    },
  });
  assert.equal(validateNotificationEvent(event).status, status);
  assert.equal(
    event.eventType,
    status === "action-required"
      ? "ccv2.deployment.action-required"
      : "ccv2.deployment.completed",
  );
}
console.log(
  "Exact shared packages and NotificationEvent v1 compatibility validated offline.",
);
