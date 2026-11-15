import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseNotificationEventJson } from "@commercekit-tools/notification-contract";
import { run } from "../src/action.js";
import { readInputs } from "../src/inputs.js";
import * as notification from "../src/notification.js";
import * as reporting from "../src/reporting.js";
import { initialResult } from "../src/result.js";
import { Sanitizer } from "../src/security.js";
import { raw } from "./fixtures.js";
import { harness, token } from "./harness.js";
import { fakeCore } from "./action-core.js";

afterEach(() => vi.restoreAllMocks());
const workflow = {
  GITHUB_REPOSITORY: "synthetic/example",
  GITHUB_RUN_ID: "123",
};
const authentication = [
  "token-endpoint",
  "client-id",
  "client-secret",
  "resource",
];
const terminal = (status = "DEPLOYED") => [
  token,
  { code: "synthetic.1" },
  { code: "synthetic.1" },
  { deploymentStatus: status },
  { code: "synthetic.1" },
];
function settings(values: Record<string, string> = raw, validated = true) {
  const safe = new Sanitizer(() => {});
  authentication.forEach((name) => safe.add(values[name] ?? ""));
  return {
    safe,
    context: reporting.inputContext(
      values,
      validated ? readInputs((name) => values[name] ?? "", safe) : undefined,
      safe,
    ),
  };
}
function parse(text: string) {
  const value = parseNotificationEventJson(text);
  if (
    value.eventType !== "ccv2.deployment.completed" &&
    value.eventType !== "ccv2.deployment.action-required"
  )
    throw Error("Expected deploy event.");
  return value;
}
function rendered(c: ReturnType<typeof fakeCore>) {
  return vi
    .mocked(c.core.summary.addRaw)
    .mock.calls.map(([text]) => text)
    .join("");
}

describe("consistent deployment reporting", () => {
  it("covers all declared Action inputs with confidential and presence-only policy", () => {
    const inputYaml = readFileSync("action.yml", "utf8")
      .split("\ninputs:\n")[1]!
      .split("\noutputs:\n")[0]!;
    const names = [...inputYaml.matchAll(/^ {2}([a-z-]+):$/gm)].map(
      (match) => match[1],
    );
    expect(reporting.inputDefinitions.map((input) => input.name)).toEqual(
      names,
    );
    expect(names).toHaveLength(21);
    expect(
      reporting.inputDefinitions
        .filter((input) => input.confidential)
        .map((input) => input.name),
    ).toEqual(authentication);
    expect(
      reporting.inputDefinitions
        .filter((input) => input.display === "presence")
        .map((input) => input.name),
    ).toEqual(["decision-reason", "traffic-split-json", "cancel-reason"]);
  });
  it("reports normalized defaults, all fields and redaction markers through the shared schema", () => {
    const { context, safe } = settings();
    expect(context.inputsValidated).toBe(true);
    expect(context.inputsTruncated).toBe(false);
    expect(context.inputs).toMatchObject({
      operation: "deploy",
      "poll-interval-seconds": "60",
      "timeout-minutes": "240",
      "green-decision": "MANUAL",
      "validate-deployment-modes": "true",
      "rollback-database": "false",
      "wait-for-completion": "true",
    });
    expect(context.inputs["api-base-url"]).toMatch(
      /^https:\/\/portalapi\.commerce\.ondemand\.com\/?$/,
    );
    for (const name of authentication)
      expect(context.inputs[name]).toBe("[REDACTED]");
    expect(Object.keys(context.inputs)).toHaveLength(21);
    const value = notification.event(
      { ...initialResult(), outcome: "success", ...context },
      workflow,
      safe,
    );
    expect(parse(JSON.stringify(value)).data).toMatchObject(context);
  });
  it.each(["deploy", "resume", "decide", "cancel"])(
    "projects safe effective settings for %s",
    (operation) => {
      const values = {
        ...raw,
        operation,
        "poll-interval-seconds": "20",
        "timeout-minutes": "8",
        ...(operation === "deploy"
          ? {}
          : {
              "deployment-code": "synthetic-existing",
              "build-code": "",
              "environment-code": "",
              "database-update-mode": "",
              strategy: "",
            }),
        ...(operation === "decide"
          ? {
              "green-decision": "ACCEPT",
              "decision-reason": "SYNTHETIC_PRIVATE_REASON",
            }
          : {}),
        ...(operation === "cancel"
          ? { "cancel-reason": "SYNTHETIC_PRIVATE_CANCEL" }
          : {}),
      };
      const { context } = settings(values);
      expect(context.inputs).toMatchObject({
        operation,
        "poll-interval-seconds": "20",
        "timeout-minutes": "8",
      });
      expect(JSON.stringify(context)).not.toContain("SYNTHETIC_PRIVATE_REASON");
      expect(JSON.stringify(context)).not.toContain("SYNTHETIC_PRIVATE_CANCEL");
    },
  );
  it("never reflects invalid structured input or free-text reason bodies", () => {
    const values = {
      ...raw,
      "traffic-split-json": '{"password":"SYNTHETIC_PRIVATE_JSON"}',
      "decision-reason": "SYNTHETIC_PRIVATE_REASON",
      "cancel-reason": "SYNTHETIC_PRIVATE_CANCEL",
      "api-base-url":
        "https://username:password@example.invalid/private?token=private",
      "environment-code": "x".repeat(1000),
    };
    const { context } = settings(values, false);
    expect(context.inputsValidated).toBe(false);
    expect(context.inputsTruncated).toBe(true);
    expect(context.inputs["environment-code"]!.length).toBeLessThanOrEqual(256);
    for (const name of [
      "traffic-split-json",
      "decision-reason",
      "cancel-reason",
    ])
      expect(context.inputs[name]).toBeTruthy();
    for (const marker of [
      "SYNTHETIC_PRIVATE_JSON",
      "SYNTHETIC_PRIVATE_REASON",
      "SYNTHETIC_PRIVATE_CANCEL",
      "username",
      "password",
      "token=private",
    ])
      expect(JSON.stringify(context)).not.toContain(marker);
  });
  it("omits validated traffic request bodies even for safe canary configuration", () => {
    const { context } = settings({
      ...raw,
      strategy: "GREEN",
      "green-decision": "PREPARE_CANARY",
      "traffic-split-json":
        '{"services":[{"code":"synthetic-private-service","percentage":20}]}',
    });
    expect(context.inputsValidated).toBe(true);
    expect(context.inputs["traffic-split-json"]).toBeTruthy();
    expect(JSON.stringify(context)).not.toContain("synthetic-private-service");
  });
  it.each([
    ["DEPLOYED", "success", "✅"],
    ["FAIL", "failure", "❌"],
    ["UNDEPLOYED", "cancelled", "⏹️"],
    ["FUTURE", "internal-error", "❌"],
  ])(
    "uses shared status styling and complete input/result tables for %s",
    async (status, outcome, icon) => {
      const c = fakeCore({ "validate-deployment-modes": "false" });
      const result = await run(c.core, harness(terminal(status)).rt, workflow);
      const value = parse(c.outputs["notification-event"]!);
      expect(result.outcome).toBe(outcome);
      expect(value.status).toBe(outcome);
      expect(value.data.inputs).toEqual(result.inputs);
      const html = rendered(c);
      for (const name of reporting.inputDefinitions.map((item) => item.name))
        expect(html).toContain(name);
      for (const expected of [
        icon,
        "CCv2 Deploy",
        "Result",
        "Inputs",
        "Operation",
        "Deployment status",
        "Poll count",
        "Duration \\(ms\\)",
        "View workflow",
        "| Input | Value |",
      ])
        expect(html).toContain(expected);
      for (const secret of [
        ...authentication.map((name) => raw[name]!),
        token.access_token,
      ])
        expect(html).not.toContain(secret);
      expect(c.core.summary.write).toHaveBeenCalledOnce();
      if (result.error)
        expect(html).toContain(result.error.code.replaceAll("_", "\\_"));
    },
  );
  it("renders manual/canary handoff as warning while preserving action-required semantics", async () => {
    const c = fakeCore({
      "validate-deployment-modes": "false",
      strategy: "GREEN",
    });
    const detail = {
      code: "synthetic.1",
      status: "DEPLOYING",
      strategy: "GREEN",
      isCanaryAvailable: true,
      canaryStatus: "STARTED",
      expireAtTimestamp: "2099-01-01T00:00:00Z",
    };
    const result = await run(
      c.core,
      harness([
        token,
        { code: "synthetic.1" },
        detail,
        { deploymentStatus: "DEPLOYING", percentage: 90 },
        detail,
        { deploymentDecisions: [] },
      ]).rt,
      workflow,
    );
    const value = parse(c.outputs["notification-event"]!);
    expect(result.outcome).toBe("action-required");
    expect(value.status).toBe("action-required");
    expect(value.data.issues?.[0]?.code).toBe("deployment-action-required");
    expect(rendered(c)).toContain("⚠️");
    expect(rendered(c)).toContain("deployment-action-required");
    expect(c.core.setFailed).not.toHaveBeenCalled();
  });
  it("captures/masks credentials first, reads once and reports invalid input before any API call", async () => {
    const c = fakeCore({ "build-code": "" });
    const order: string[] = [];
    vi.mocked(c.core.getInput).mockImplementation((name) => {
      order.push(`read:${name}`);
      return name === "build-code" ? "" : (raw[name] ?? "");
    });
    vi.mocked(c.core.setSecret).mockImplementation((value) => {
      order.push(`mask:${value}`);
    });
    const h = harness([]);
    const result = await run(c.core, h.rt);
    expect(result.inputsValidated).toBe(false);
    expect(parse(c.outputs["notification-event"]!).data.inputs).toEqual(
      result.inputs,
    );
    expect(rendered(c)).toContain("INVALID\\_INPUT");
    expect(h.fetcher).not.toHaveBeenCalled();
    for (const name of authentication)
      expect(order.indexOf(`mask:${raw[name]}`)).toBeLessThan(
        order.indexOf("read:operation"),
      );
    expect(
      vi.mocked(c.core.getInput).mock.calls.map(([name]) => name),
    ).toHaveLength(21);
  });
  it("escapes malicious text and masks secrets in every output/summary", async () => {
    const c = fakeCore({
      "subscription-code": `<script>alert(1)</script>&${raw["client-secret"]}`,
    });
    await run(c.core, harness([]).rt);
    expect(rendered(c)).not.toContain("<script>");
    expect(rendered(c)).not.toContain(raw["client-secret"]);
    expect(rendered(c)).toContain("&amp;");
    expect(JSON.stringify(c.outputs)).not.toContain(raw["client-secret"]);
  });
  it("keeps successful domain result, outputs and summary when event creation fails", async () => {
    vi.spyOn(notification, "event").mockImplementationOnce(() => {
      throw Error("SYNTHETIC_PRIVATE_REPORT_ERROR");
    });
    const c = fakeCore({ "validate-deployment-modes": "false" });
    const result = await run(c.core, harness(terminal()).rt);
    expect(result.outcome).toBe("success");
    expect(JSON.parse(c.outputs["result-json"]!).outcome).toBe("success");
    expect(c.outputs["notification-event"]).toBe("");
    expect(c.core.setFailed).not.toHaveBeenCalled();
    expect(rendered(c)).toContain("notification-unavailable");
    expect(rendered(c)).not.toContain("SYNTHETIC_PRIVATE_REPORT_ERROR");
  });
  it("preserves primary deployment failure and summary when every output write fails", async () => {
    const c = fakeCore({ "validate-deployment-modes": "false" });
    vi.mocked(c.core.setOutput).mockImplementation(() => {
      throw Error("private");
    });
    const result = await run(c.core, harness(terminal("FAIL")).rt);
    expect(result.error?.code).toBe("DEPLOYMENT_FAILED");
    expect(c.core.setFailed).toHaveBeenCalledWith(result.error?.message);
    expect(rendered(c)).toContain("outputs-unavailable");
    expect(c.core.summary.write).toHaveBeenCalledOnce();
  });
  it("fails the output contract separately while retaining successful deployment", async () => {
    const c = fakeCore({ "validate-deployment-modes": "false" });
    vi.mocked(c.core.setOutput).mockImplementationOnce(() => {
      throw Error("private");
    });
    const result = await run(c.core, harness(terminal()).rt);
    expect(result.outcome).toBe("success");
    expect(parse(c.outputs["notification-event"]!).status).toBe("success");
    expect(c.core.setFailed).toHaveBeenCalledWith(
      "Action result outputs could not be written.",
    );
  });
  it("retains original result when input snapshot or summary creation fails", async () => {
    vi.spyOn(reporting, "inputContext").mockImplementationOnce(() => {
      throw Error("private");
    });
    vi.spyOn(reporting, "summary").mockImplementationOnce(() => {
      throw Error("private");
    });
    const c = fakeCore({ "validate-deployment-modes": "false" });
    const result = await run(c.core, harness(terminal()).rt);
    expect(result.outcome).toBe("success");
    expect(c.outputs["result-json"]).toBeTruthy();
    expect(c.core.warning).toHaveBeenCalledTimes(2);
    expect(c.core.setFailed).not.toHaveBeenCalled();
  });
  it.each(["success", "deploy"])(
    "preserves trusted semantic enums when a credential equals %s",
    async (secret) => {
      const c = fakeCore({
        "client-secret": secret,
        "build-code": secret,
        "validate-deployment-modes": "false",
      });
      const result = await run(c.core, harness(terminal()).rt);
      expect(result.operation).toBe("deploy");
      expect(result.inputs?.["build-code"]).toBe("[REDACTED]");
      expect(result.outcome).toBe("success");
      expect(parse(c.outputs["notification-event"]!).status).toBe("success");
      expect(result.inputs?.["client-secret"]).toBe("[REDACTED]");
      expect(c.core.setFailed).not.toHaveBeenCalled();
      expect(rendered(c)).toContain("✅");
    },
  );
  it("keeps all invalid Unicode input settings within the shared 64 KiB event bound", async () => {
    const values = Object.fromEntries(
      reporting.inputDefinitions
        .filter((input) => !input.confidential)
        .map((input) => [input.name, "\ud800".repeat(2000)]),
    );
    const c = fakeCore(values);
    const h = harness([]);
    const result = await run(c.core, h.rt);
    const text = c.outputs["notification-event"]!;
    expect(text).toBeTruthy();
    expect(Buffer.byteLength(text)).toBeGreaterThan(16384);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);
    const value = parse(text);
    expect(Object.keys(value.data.inputs!).sort()).toEqual(
      reporting.inputDefinitions.map((input) => input.name).sort(),
    );
    expect(value.data.inputsValidated).toBe(false);
    expect(value.data.inputsTruncated).toBe(true);
    expect(result.inputsValidated).toBe(false);
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(rendered(c)).toContain("Inputs");
  });
  it("bounds a faulty oversized notification without losing the successful result", async () => {
    const original = notification.event;
    vi.spyOn(notification, "event").mockImplementationOnce(
      (result, env, safe) => ({
        ...original(result, env, safe),
        links: Array.from({ length: 1000 }, () => ({
          label: "Synthetic workflow",
          url: "https://github.com/synthetic/example/actions/runs/123",
        })),
      }),
    );
    const c = fakeCore({ "validate-deployment-modes": "false" });
    const result = await run(c.core, harness(terminal()).rt);
    expect(result.outcome).toBe("success");
    expect(c.outputs["notification-event"]).toBe("");
    expect(JSON.parse(c.outputs["result-json"]!).outcome).toBe("success");
    expect(rendered(c)).toContain("notification-unavailable");
    expect(c.core.setFailed).not.toHaveBeenCalled();
  });
  it("bounds an oversized result snapshot and still writes other outputs and the summary", async () => {
    vi.spyOn(reporting, "inputContext").mockReturnValueOnce({
      inputs: Object.fromEntries(
        Array.from({ length: 400 }, (_, index) => [
          `synthetic-${index}`,
          "x".repeat(256),
        ]),
      ),
      inputsValidated: true,
      inputsTruncated: false,
    });
    const c = fakeCore({ "validate-deployment-modes": "false" });
    const result = await run(c.core, harness(terminal()).rt);
    expect(result.outcome).toBe("success");
    expect(c.outputs["result-json"]).toBeUndefined();
    expect(c.outputs["duration-ms"]).toBe("0");
    expect(c.core.setFailed).toHaveBeenCalledWith(
      "Action result outputs could not be written.",
    );
    expect(rendered(c)).toContain("outputs-unavailable");
    expect(Buffer.byteLength(rendered(c))).toBeLessThanOrEqual(65536);
  });
  it("renders legacy optional context and operational detail without exposing raw reasons", () => {
    const safe = new Sanitizer(() => {});
    safe.add("synthetic-secret");
    expect(safe.knownSecrets()).toEqual(["synthetic-secret"]);
    expect(safe.knownSecrets()).not.toBe(safe.knownSecrets());
    expect(reporting.summary(initialResult(), safe, {})).toContain("❌");
    expect(
      reporting.summary(
        {
          ...initialResult(),
          inputs: {},
          cancellation: { requested: true, rollbackDatabase: false },
          trafficSplit: { updated: true },
          issues: [{ code: "safe", message: "Issue" }],
        },
        safe,
        {},
      ),
    ).toContain("Traffic split updated");
  });
});
