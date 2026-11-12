import { validateNotificationEvent } from "@commercekit-tools/notification-contract";
const validateEvent = (value: unknown) =>
  Boolean(validateNotificationEvent(value));
import { it, expect, vi } from "vitest";
import { run, type Core } from "../src/action.js";
import { raw } from "./fixtures.js";
import { harness, token } from "./harness.js";
import { context, event } from "../src/notification.js";
import { Sanitizer } from "../src/security.js";
import { initialResult } from "../src/result.js";
export function fakeCore(overrides: Record<string, string> = {}) {
  const outputs: Record<string, string> = {};
  const calls: string[] = [];
  const summary = { addRaw: vi.fn(), write: vi.fn(async () => {}) };
  const core = {
    getInput: vi.fn((n: string) => overrides[n] ?? raw[n] ?? ""),
    setSecret: vi.fn(),
    setOutput: vi.fn((k: string, v: string) => {
      if (k === "notification-event") validateNotificationEvent(JSON.parse(v));
      calls.push(k);
      outputs[k] = v;
    }),
    setFailed: vi.fn(() => {
      calls.push("failed");
    }),
    info: vi.fn(),
    warning: vi.fn(),
    summary,
  } as unknown as Core;
  return { core, outputs, calls };
}
const id = "synthetic-deploy";
const detail = {
  code: id,
  status: "DEPLOYING",
  buildCode: "synthetic-build",
  environmentCode: "synthetic-env",
  strategy: "GREEN",
  isCanaryAvailable: true,
  canaryStatus: "STARTED",
  expireAtTimestamp: "2099-01-01T00:00:00Z",
};
const base = { "validate-deployment-modes": "false" };
const existing = (operation: string) => ({
  operation,
  "deployment-code": id,
  "build-code": "",
  "environment-code": "",
  strategy: "",
  "database-update-mode": "",
});
it.each([
  ["DEPLOYED", "success"],
  ["FAIL", "failure"],
  ["UNDEPLOYED", "cancelled"],
  ["FUTURE", "internal-error"],
])("maps terminal %s with valid event", async (status, outcome) => {
  const c = fakeCore(base);
  const h = harness([
    token,
    { code: id },
    { code: id },
    { deploymentStatus: "SCHEDULED", percentage: 0 },
    { code: id },
    { deploymentStatus: "DEPLOYING", percentage: 40 },
    { code: id },
    { deploymentStatus: status, percentage: 95 },
    { code: id },
  ]);
  const r = await run(c.core, h.rt, {
    GITHUB_REPOSITORY: "synthetic/example",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
  });
  expect(r.outcome).toBe(outcome);
  expect(r.deploymentStatus).toBe(status);
  expect(r.pollCount).toBe(3);
  expect(validateEvent(JSON.parse(c.outputs["notification-event"]!))).toBe(
    true,
  );
  if (outcome !== "success") expect(c.calls.at(-1)).toBe("failed");
});
it.each(["MANUAL", "ACCEPT", "REJECT", "PREPARE_CANARY"])(
  "handles green %s",
  async (decision) => {
    const c = fakeCore({
      ...base,
      strategy: "GREEN",
      "green-decision": decision,
      ...(decision === "PREPARE_CANARY"
        ? {
            "traffic-split-json":
              '{"endpoints":[{"code":"synthetic","percentage":10}]}',
          }
        : {}),
    });
    const terminal = decision === "REJECT" ? "UNDEPLOYED" : "DEPLOYED";
    const h = harness([
      token,
      { code: id },
      detail,
      { deploymentStatus: "DEPLOYING", percentage: 90 },
      detail,
      { deploymentDecisions: [] },
      ...(decision === "MANUAL"
        ? []
        : [
            { decision, newDeploymentCode: "synthetic-new" },
            ...(decision === "PREPARE_CANARY"
              ? [
                  Response.json(
                    { endpoints: [{ code: "synthetic", percentage: 10 }] },
                    { status: 201 },
                  ),
                  { ...detail, code: "synthetic-new" },
                ]
              : [{ deploymentStatus: terminal }, { code: "synthetic-new" }]),
          ]),
    ]);
    const r = await run(c.core, h.rt);
    expect(r.outcome).toBe(
      ["MANUAL", "PREPARE_CANARY"].includes(decision)
        ? "action-required"
        : decision === "REJECT"
          ? "cancelled"
          : "success",
    );
    expect(validateEvent(JSON.parse(c.outputs["notification-event"]!))).toBe(
      true,
    );
    expect(r.originalDeploymentCode).toBe(id);
    if (decision !== "MANUAL") expect(r.deploymentCode).toBe("synthetic-new");
  },
);
it("explicit cancel checks options and monitors", async () => {
  const c = fakeCore(existing("cancel"));
  const h = harness([
    token,
    detail,
    {},
    new Response(null, { status: 202 }),
    { deploymentStatus: "UNDEPLOYED" },
    { code: id },
  ]);
  const r = await run(c.core, h.rt);
  expect(r).toMatchObject({
    outcome: "cancelled",
    cancellation: { requested: true, rollbackDatabase: false },
  });
  expect(c.calls.indexOf("notification-event")).toBeLessThan(
    c.calls.indexOf("failed"),
  );
});
it("resume recovers identifiers", async () => {
  const c = fakeCore(existing("resume"));
  const h = harness([token, detail, { deploymentStatus: "DEPLOYED" }, detail]);
  expect(await run(c.core, h.rt)).toMatchObject({
    buildCode: "synthetic-build",
    environmentCode: "synthetic-env",
    outcome: "success",
  });
});
it("decide refuses terminal deployment", async () => {
  const c = fakeCore({ ...existing("decide"), "green-decision": "ACCEPT" });
  expect(
    await run(
      c.core,
      harness([token, detail, { deploymentStatus: "DEPLOYED" }]).rt,
    ),
  ).toMatchObject({ error: { code: "DEPLOYMENT_DECISION_FAILED" } });
});
it("wait timeout preserves status without remote cancellation", async () => {
  const c = fakeCore({ ...base, "timeout-minutes": "1" });
  const h = harness([
    token,
    { code: id },
    { code: id },
    { deploymentStatus: "DEPLOYING", percentage: 40 },
    { code: id },
  ]);
  expect(await run(c.core, h.rt)).toMatchObject({
    timedOut: true,
    percentage: 40,
    deploymentStatus: "DEPLOYING",
    error: { code: "DEPLOYMENT_WAIT_TIMEOUT" },
  });
  expect(
    h.fetcher.mock.calls.every(([url]) => !url.includes("cancellation")),
  ).toBe(true);
});
it.each([true, false])(
  "outputs survive input/internal failure %s",
  async (unexpected) => {
    const c = fakeCore({ "build-code": "" });
    if (unexpected)
      vi.mocked(c.core.getInput).mockImplementation(() => {
        throw Error("secret");
      });
    await run(c.core, harness([]).rt);
    expect(validateEvent(JSON.parse(c.outputs["notification-event"]!))).toBe(
      true,
    );
    expect(c.calls.at(-1)).toBe("failed");
  },
);
it("sanitizes secrets in all public sinks", async () => {
  const c = fakeCore({ ...base, "build-code": raw["client-secret"]! });
  const h = harness([
    token,
    { code: id },
    { code: id },
    Response.json(
      { title: Object.values(raw).join(" ") + token.access_token },
      { status: 403 },
    ),
  ]);
  await run(c.core, h.rt);
  const sinks = JSON.stringify([
    c.outputs,
    vi.mocked(c.core.info).mock.calls,
    vi.mocked(c.core.warning).mock.calls,
    vi.mocked(c.core.setFailed).mock.calls,
    vi.mocked(c.core.summary.addRaw).mock.calls,
  ]);
  for (const s of [...Object.values(raw).slice(0, 4), token.access_token])
    expect(sinks).not.toContain(s);
});
it("summary errors remain safe", async () => {
  const c = fakeCore({ "build-code": "" });
  vi.mocked(c.core.summary.write).mockRejectedValue(Error("secret"));
  await run(c.core, harness([]).rt);
  expect(c.core.warning).toHaveBeenCalled();
});
it.each([true, false])("fallback publishing %s", async (persistent) => {
  const c = fakeCore({ "build-code": "" });
  if (persistent)
    vi.mocked(c.core.setOutput).mockImplementation(() => {
      throw Error();
    });
  else
    vi.mocked(c.core.setOutput).mockImplementationOnce(() => {
      throw Error();
    });
  await run(c.core, harness([]).rt);
  expect(c.core.setFailed).toHaveBeenCalled();
});
it("abort never cancels remotely", async () => {
  const c = fakeCore();
  const a = new AbortController();
  a.abort();
  const h = harness([]);
  expect(await run(c.core, h.rt, {}, a.signal)).toMatchObject({
    error: { code: "ACTION_CANCELLED" },
  });
  expect(h.fetcher).not.toHaveBeenCalled();
});
it("context rejects unsafe values", () => {
  const s = new Sanitizer(() => {});
  s.add("FAKE_SECRET");
  expect(
    context(
      {
        GITHUB_ACTOR: "a\n",
        GITHUB_WORKFLOW: "FAKE_SECRET",
        GITHUB_SERVER_URL: "http://unsafe",
      },
      s,
    ),
  ).toEqual({});
  expect(() => event({ ...initialResult(), durationMs: -1 }, {}, s)).toThrow();
});
it("overall deadline aborts pending requests", async () => {
  vi.useFakeTimers();
  try {
    const c = fakeCore({ "timeout-minutes": "1" });
    const h = harness([]);
    h.rt.fetch = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init!.signal!.addEventListener("abort", () => reject(Error())),
        ),
    );
    const p = run(c.core, h.rt);
    await vi.advanceTimersByTimeAsync(60000);
    expect(await p).toMatchObject({ timedOut: true });
  } finally {
    vi.useRealTimers();
  }
});
it("preflights default deployment modes", async () => {
  const c = fakeCore();
  const h = harness([
    token,
    [
      {
        environmentCode: "synthetic-env",
        deploymentModes: {
          dataMigrationMode: ["NONE"],
          deploymentMode: ["ROLLING_UPDATE"],
        },
      },
    ],
    { code: id },
    { code: id },
    { deploymentStatus: "DEPLOYED" },
    { code: id },
  ]);
  expect((await run(c.core, h.rt)).outcome).toBe("success");
});
it("rejects automatic green decision for recovered rolling deployment", async () => {
  const c = fakeCore({ ...existing("resume"), "green-decision": "ACCEPT" });
  expect(
    await run(c.core, harness([token, { code: id, strategy: "RECREATE" }]).rt),
  ).toMatchObject({ error: { code: "INVALID_INPUT" } });
});
it("canary without split remains action required", async () => {
  const c = fakeCore({
    ...existing("decide"),
    "green-decision": "PREPARE_CANARY",
  });
  const h = harness([
    token,
    detail,
    { deploymentStatus: "DEPLOYING" },
    detail,
    { deploymentDecisions: [] },
    { decision: "PREPARE_CANARY" },
    detail,
  ]);
  expect(await run(c.core, h.rt)).toMatchObject({
    outcome: "action-required",
    decision: "PREPARE_CANARY",
  });
});
it.each(["decision", "traffic", "cancel"])(
  "publishes internal-error before failing %s mutation",
  async (operation) => {
    const c = fakeCore(
      operation === "cancel"
        ? existing("cancel")
        : {
            ...existing("decide"),
            "green-decision":
              operation === "traffic" ? "PREPARE_CANARY" : "ACCEPT",
            ...(operation === "traffic"
              ? {
                  "traffic-split-json":
                    '{"services":[{"code":"synthetic","percentage":10}]}',
                }
              : {}),
          },
    );
    const prefix =
      operation === "cancel"
        ? [token, detail, {}]
        : [
            token,
            detail,
            { deploymentStatus: "DEPLOYING" },
            detail,
            { deploymentDecisions: [] },
            ...(operation === "traffic"
              ? [{ decision: "PREPARE_CANARY" }]
              : []),
          ];
    const r = await run(
      c.core,
      harness([...prefix, Response.json({}, { status: 500 })]).rt,
    );
    expect(r.outcome).toBe("internal-error");
    expect(r.error?.code).toMatch(/AMBIGUOUS$/);
    expect(validateEvent(JSON.parse(c.outputs["notification-event"]!))).toBe(
      true,
    );
    expect(c.calls.at(-1)).toBe("failed");
  },
);
it.each(["FAIL", "DEPLOYING"])(
  "monitors cancellation to failure or timeout %s",
  async (status) => {
    const c = fakeCore({ ...existing("cancel"), "timeout-minutes": "1" });
    const h = harness([
      token,
      detail,
      {},
      new Response(null, { status: 202 }),
      { deploymentStatus: status },
      { code: id },
    ]);
    const r = await run(c.core, h.rt);
    expect(r.outcome).toBe(status === "FAIL" ? "failure" : "internal-error");
    expect(r.cancellation?.requested).toBe(true);
  },
);
it("does not repeat a previously prepared canary", async () => {
  const c = fakeCore({
    ...existing("decide"),
    "green-decision": "PREPARE_CANARY",
  });
  const h = harness([
    token,
    detail,
    { deploymentStatus: "DEPLOYING" },
    detail,
    { deploymentDecisions: [{ type: "PREPARE_CANARY" }] },
  ]);
  expect(await run(c.core, h.rt)).toMatchObject({
    error: { code: "DEPLOYMENT_DECISION_FAILED" },
  });
  expect(h.fetcher).toHaveBeenCalledTimes(5);
});
it("preserves long unknown vendor status in result without breaking event bounds", async () => {
  const c = fakeCore(base);
  const status = "X".repeat(128);
  const h = harness([
    token,
    { code: id },
    { code: id },
    { deploymentStatus: status },
  ]);
  expect((await run(c.core, h.rt)).deploymentStatus).toBe(status);
  const e = JSON.parse(c.outputs["notification-event"]!);
  expect(validateEvent(e)).toBe(true);
  expect(e.data.deploymentStatus).toBeUndefined();
});
