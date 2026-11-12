import { it, expect, vi } from "vitest";
import { Ccv2TransportError } from "@commercekit-tools/ccv2-client";
import { validateNotificationEvent } from "@commercekit-tools/notification-contract";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { harness, token } from "./harness.js";
import { transportError } from "../src/client.js";
import { context, event } from "../src/notification.js";
import { initialResult } from "../src/result.js";
const id = "synthetic-deploy";
const modes = [
  {
    environmentCode: "synthetic-env",
    deploymentModes: {
      dataMigrationMode: ["NONE"],
      deploymentMode: ["ROLLING_UPDATE"],
    },
  },
];
it("pins published packages without local schema or authentication copies", () => {
  const require = createRequire(import.meta.url);
  const p = JSON.parse(readFileSync("package.json", "utf8"));
  for (const name of [
    "@commercekit-tools/notification-contract",
    "@commercekit-tools/ccv2-client",
  ]) {
    expect(p.dependencies[name]).toBe("0.0.2");
    expect(require(name + "/package.json").version).toBe("0.0.2");
  }
  expect(
    require("@commercekit-tools/notification-contract/schema").properties
      .schemaVersion.const,
  ).toBe(1);
  for (const file of [
    "src/auth.ts",
    "src/http.ts",
    "contracts/notification-event-v1.schema.json",
    "scripts/update-notify.mjs",
  ])
    expect(existsSync(file)).toBe(false);
});
it("registers only credentials and tokens as secrets, never deployment inputs", async () => {
  const h = harness([token]);
  await h.client.authenticate();
  for (const value of [
    "FAKE_CLIENT_ID",
    "FAKE_CLIENT_SECRET",
    "FAKE_RESOURCE",
    token.access_token,
  ])
    expect(h.safe.contains(value)).toBe(true);
  for (const value of [
    "deploy",
    "synthetic-deploy",
    "synthetic-build",
    "MANUAL",
    "ROLLING_UPDATE",
  ])
    expect(h.safe.contains(value)).toBe(false);
});
it("assigns policies to every endpoint and accepts mode arrays and empty cancellation", async () => {
  const h = harness([
    token,
    modes,
    { code: id },
    { code: id },
    { deploymentStatus: "DEPLOYING" },
    { deploymentDecisions: [] },
    { decision: "ACCEPT" },
    {},
    new Response(null, { status: 202 }),
    {},
  ]);
  const request = vi.spyOn(h.client, "request");
  await h.api.modes();
  await h.api.create();
  await h.api.detail(id);
  await h.api.progress(id);
  await h.api.decisions(id);
  await h.api.decide(id, "ACCEPT");
  await h.api.cancel(id);
  await h.api.updateTraffic(id, {});
  expect(
    request.mock.calls.map(([path, options]) => [
      path.split("/").slice(3).join("/"),
      options.policy,
    ]),
  ).toEqual([
    ["deploymentmodes", "safe-read"],
    ["deployments", "unsafe-mutation"],
    [`deployments/${id}`, "safe-read"],
    [`deployments/${id}/progress`, "safe-read"],
    [`deployments/${id}/decisions`, "safe-read"],
    [`deployments/${id}/decisions`, "unsafe-mutation"],
    [`deployments/${id}/cancellationoptions`, "safe-read"],
    [`deployments/${id}/cancellation`, "unsafe-mutation"],
    [`deployments/${id}/trafficsplit`, "unsafe-mutation"],
  ]);
  for (const [, init] of h.fetcher.mock.calls) {
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
  }
});
it.each([401, 429, 500, 503])(
  "mode preflight recovers from %i",
  async (status) => {
    const h = harness([
      token,
      Response.json({}, { status, headers: { "Retry-After": "2" } }),
      ...(status === 401 ? [token] : []),
      modes,
    ]);
    await h.api.modes();
    expect(h.fetcher).toHaveBeenCalledTimes(status === 401 ? 4 : 3);
    if (status !== 401)
      expect(h.rt.sleep).toHaveBeenCalledWith(2000, h.client.signal);
  },
);
it("uses epoch time for HTTP-date Retry-After with a monotonic Action clock", async () => {
  vi.spyOn(Date, "now").mockReturnValue(0);
  try {
    const h = harness([
      token,
      Response.json(
        {},
        {
          status: 429,
          headers: { "Retry-After": "Thu, 01 Jan 1970 00:00:05 GMT" },
        },
      ),
      modes,
    ]);
    await h.api.modes();
    expect(h.rt.sleep).toHaveBeenCalledWith(5000, h.client.signal);
  } finally {
    vi.restoreAllMocks();
  }
});
it.each([400, 403, 409, 412, 423])(
  "suppresses provider problem details for HTTP %i",
  async (status) => {
    const h = harness([
      token,
      Response.json(
        { title: "PRIVATE_TITLE", detail: "PRIVATE_DETAIL FAKE_CLIENT_SECRET" },
        { status, headers: { "content-type": "application/problem+json" } },
      ),
    ]);
    try {
      await h.api.create();
      throw Error("Unexpected success");
    } catch (error) {
      expect(error).toMatchObject({
        code: "CREATE_DEPLOYMENT_FAILED",
        httpStatus: status,
      });
      expect(JSON.stringify(error)).not.toMatch(/PRIVATE|FAKE_/);
    }
  },
);
it.each(["bad", "null", '"text"', "x".repeat(262145)])(
  "rejects malformed or oversized detail without retry",
  async (body) => {
    const h = harness([
      token,
      new Response(body, { headers: { "content-type": "application/json" } }),
    ]);
    await expect(h.api.detail(id)).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
    });
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  },
);
it.each([new Response(null), new Response("binary")])(
  "rejects empty/binary detail",
  async (response) => {
    const h = harness([token, response]);
    await expect(h.api.detail(id)).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
    });
  },
);
it("translates refresh authentication failure without attempting a second mutation", async () => {
  const h = harness([
    token,
    Response.json({}, { status: 401 }),
    Response.json({}, { status: 403 }),
  ]);
  await expect(h.api.create()).rejects.toMatchObject({
    code: "AUTHENTICATION_FAILED",
  });
  expect(h.fetcher).toHaveBeenCalledTimes(3);
});
it("translates network exhaustion without exposing causes", async () => {
  const h = harness([
    token,
    new Error("SECRET"),
    new Error("SECRET"),
    new Error("SECRET"),
  ]);
  await expect(h.api.progress(id)).rejects.toMatchObject({
    code: "REQUEST_FAILED",
    message: "The API request could not be completed.",
  });
  expect(h.api.pollCount).toBe(3);
});
it("translates package deadline errors", () =>
  expect(transportError(new Ccv2TransportError("DEADLINE"))).toMatchObject({
    code: "DEPLOYMENT_WAIT_TIMEOUT",
  }));
it("filters workflow URL containing a registered secret", () => {
  const h = harness([]);
  h.safe.add("actions/runs");
  expect(
    context(
      { GITHUB_REPOSITORY: "synthetic/example", GITHUB_RUN_ID: "123" },
      h.safe,
    ),
  ).not.toHaveProperty("runUrl");
});
it.each([
  "success",
  "failure",
  "cancelled",
  "action-required",
  "internal-error",
] as const)("preserves %s event fields and workflow link", (outcome) => {
  const h = harness([]);
  const value = event(
    {
      ...initialResult(),
      outcome,
      actionRequired: outcome === "action-required",
      subscriptionCode: "synthetic-subscription",
      originalDeploymentCode: "synthetic-original",
      deploymentCode: "synthetic-current",
      buildCode: "synthetic-build",
      environmentCode: "synthetic-env",
      databaseUpdateMode: "NONE",
      strategy: "GREEN",
      deploymentStatus: "DEPLOYING",
      decision: "PREPARE_CANARY",
      durationMs: 123,
      error: { code: "SYNTHETIC_ERROR", message: "Synthetic error." },
    },
    {
      GITHUB_REPOSITORY: "synthetic/example",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: "abc123",
      GITHUB_ACTOR: "synthetic",
      GITHUB_WORKFLOW: "Deploy",
      GITHUB_JOB: "deploy",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "2",
    },
    h.safe,
  );
  expect(validateNotificationEvent(value)).toEqual(value);
  expect(value).toMatchObject({
    schemaVersion: 1,
    status: outcome,
    source: { product: "commercekit", component: "ccv2-deploy" },
    eventType:
      outcome === "action-required"
        ? "ccv2.deployment.action-required"
        : "ccv2.deployment.completed",
    context: {
      repository: "synthetic/example",
      ref: "refs/heads/main",
      commit: "abc123",
      actor: "synthetic",
      workflow: "Deploy",
      job: "deploy",
      runId: "123",
      runAttempt: 2,
      runUrl: "https://github.com/synthetic/example/actions/runs/123",
    },
    links: [
      {
        label: "View workflow",
        url: "https://github.com/synthetic/example/actions/runs/123",
      },
    ],
    data: {
      deploymentCode: "synthetic-current",
      buildCode: "synthetic-build",
      environmentCode: "synthetic-env",
      deploymentMode: "GREEN",
      databaseUpdateMode: "NONE",
      decisionType: "PREPARE_CANARY",
      durationMs: 123,
      error: { code: "SYNTHETIC_ERROR", message: "Synthetic error." },
    },
  });
  expect(value.data).not.toHaveProperty("originalDeploymentCode");
});

it("delegates the GitHub environment allowlist to the package without reading other values", () => {
  const h = harness([]);
  const env = { GITHUB_REPOSITORY: "synthetic/example", GITHUB_RUN_ID: "123" };
  Object.defineProperty(env, "GITHUB_EVENT_PATH", {
    get() {
      throw Error("Full GitHub event must not be read");
    },
  });
  Object.defineProperty(env, "UNRELATED_SECRET", {
    enumerable: true,
    get() {
      throw Error("Full environment must not be read");
    },
  });
  expect(context(env, h.safe)).toMatchObject({
    runUrl: "https://github.com/synthetic/example/actions/runs/123",
  });
});
it("retains Deploy markup/JWT protection while using shared stack and secret sanitization", () => {
  const h = harness([]);
  h.safe.add("synthetic secret&value");
  for (const value of [
    "synthetic secret&value",
    encodeURIComponent("synthetic secret&value"),
    new URLSearchParams({ v: "synthetic secret&value" }).toString().slice(2),
  ])
    expect(h.safe.text(value)).toBe("[REDACTED]");
  expect(h.safe.text("<b>Error</b> at privateFunction(private-file:1)")).toBe(
    "Error",
  );
  expect(h.safe.text("eyJsynthetic.payload.signature")).toBe("[REDACTED]");
  expect(h.safe.text("<b></b>")).toBe("");
  expect(h.safe.error("")).toBe("Operation failed.");
  expect(h.safe.text("bounded", 3)).toBe("bou");
});
