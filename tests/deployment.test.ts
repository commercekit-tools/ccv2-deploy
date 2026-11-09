import { it, expect } from "vitest";
import { harness, token } from "./harness.js";
import { DeploymentApi, decisionPoint } from "../src/api.js";
import { inputs } from "./fixtures.js";
const id = "synthetic-deploy";
const detail = {
  code: id,
  status: "DEPLOYING",
  strategy: "GREEN",
  isCanaryAvailable: true,
  canaryStatus: "STARTED",
  expireAtTimestamp: "2099-01-01T00:00:00Z",
};
it("creates with exact body and authentication", async () => {
  const h = harness([token, { code: id }]);
  expect(await h.api.create()).toBe(id);
  const [url, init] = h.fetcher.mock.calls[1]!;
  expect(url).toContain("/v2/subscriptions/synthetic-subscription/deployments");
  expect(JSON.parse(init.body as string)).toEqual({
    buildCode: "synthetic-build",
    environmentCode: "synthetic-env",
    databaseUpdateMode: "NONE",
    strategy: "ROLLING_UPDATE",
  });
  expect(init.headers).toHaveProperty(
    "x-approuter-authorization",
    "Bearer FAKE_ACCESS_TOKEN",
  );
  expect(init.headers).not.toHaveProperty("Authorization");
});
it.each([
  null,
  {},
  [{ environmentCode: "other" }],
  [{ environmentCode: "synthetic-env", deploymentModes: {} }],
  [
    {
      environmentCode: "synthetic-env",
      deploymentModes: {
        dataMigrationMode: ["UPDATE"],
        deploymentMode: ["GREEN"],
      },
    },
  ],
])("rejects unavailable modes", async (b) => {
  const h = harness([token, b ?? {}]);
  await expect(h.api.modes()).rejects.toMatchObject({
    code: "DEPLOYMENT_MODE_NOT_ALLOWED",
  });
});
it("validates modes", async () => {
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
  ]);
  await h.api.modes();
});
it.each(["create", "decide", "cancel", "traffic"] as const)(
  "%s never replays ambiguous mutations",
  async (op) => {
    for (const failure of [
      new Error("secret"),
      Response.json({}, { status: 429 }),
      Response.json({}, { status: 503 }),
      new Response("bad", { status: 201 }),
    ]) {
      const h = harness([token, ...(op === "cancel" ? [{}] : []), failure]);
      const promise =
        op === "create"
          ? h.api.create()
          : op === "decide"
            ? h.api.decide(id, "ACCEPT")
            : op === "cancel"
              ? h.api.cancel(id)
              : h.api.updateTraffic(id, {});
      await expect(promise).rejects.toMatchObject({
        code: expect.stringMatching(/AMBIGUOUS$/),
      });
      expect(h.fetcher).toHaveBeenCalledTimes(op === "cancel" ? 3 : 2);
    }
  },
);
it.each([400, 403, 404, 409, 412, 423])(
  "normalizes create error %i",
  async (status) => {
    const h = harness([token, Response.json({ detail: "secret" }, { status })]);
    await expect(h.api.create()).rejects.toMatchObject({
      code: "CREATE_DEPLOYMENT_FAILED",
      httpStatus: status,
    });
  },
);
it.each(["create", "decide", "cancel", "traffic"] as const)(
  "%s refreshes once on 401",
  async (op) => {
    const h = harness([
      token,
      ...(op === "cancel" ? [{}] : []),
      Response.json({}, { status: 401 }),
      token,
      op === "create"
        ? { code: id }
        : op === "decide"
          ? { decision: "ACCEPT" }
          : op === "cancel"
            ? new Response(null, { status: 202 })
            : Response.json({}, { status: 201 }),
    ]);
    await (op === "create"
      ? h.api.create()
      : op === "decide"
        ? h.api.decide(id, "ACCEPT")
        : op === "cancel"
          ? h.api.cancel(id)
          : h.api.updateTraffic(id, {}));
    expect(h.fetcher).toHaveBeenCalledTimes(op === "cancel" ? 5 : 4);
  },
);
it.each([429, 503, "network"])("retries safe progress %s", async (status) => {
  const h = harness([
    token,
    status === "network"
      ? new Error()
      : Response.json({}, { status: Number(status) }),
    { deploymentStatus: "DEPLOYING", percentage: 40 },
  ]);
  expect(await h.api.progress(id)).toEqual({
    deploymentStatus: "DEPLOYING",
    percentage: 40,
  });
  expect(h.api.pollCount).toBe(2);
});
it("reads bounded detail and history", async () => {
  const h = harness([
    token,
    {
      ...detail,
      buildCode: "synthetic-build",
      environmentCode: "synthetic-env",
      databaseUpdateMode: "NONE",
    },
    { deploymentDecisions: [{ type: "PREPARE_CANARY" }] },
  ]);
  expect(await h.api.detail(id)).toMatchObject(detail);
  expect(await h.api.decisions(id)).toEqual(["PREPARE_CANARY"]);
});
it("decision predicate requires more than percentage", () => {
  const p = { deploymentStatus: "DEPLOYING", percentage: 90 };
  expect(decisionPoint(detail, p, [])).toBe(true);
  for (const d of [
    { ...detail, canaryStatus: undefined },
    { ...detail, expireAtTimestamp: "2000-01-01T00:00:00Z" },
    { ...detail, isCanaryAvailable: false },
  ])
    expect(decisionPoint(d as typeof detail, p, [])).toBe(false);
  expect(decisionPoint(detail, p, ["ACCEPT"])).toBe(false);
  expect(decisionPoint(detail, p, ["PREPARE_CANARY"])).toBe(true);
});
it.each(["ACCEPT", "PREPARE_CANARY", "REJECT"] as const)(
  "normalizes %s and typo",
  async (decision) => {
    const h = harness([
      token,
      { decison: decision, newDeploymentCode: "synthetic-new" },
    ]);
    expect(await h.api.decide(id, decision)).toBe("synthetic-new");
  },
);
it.each([404, 501])("cancellation options %i prohibit POST", async (status) => {
  const h = harness([token, Response.json({}, { status })]);
  await expect(h.api.cancel(id)).rejects.toMatchObject({
    code:
      status === 404
        ? "DEPLOYMENT_CANCELLATION_UNAVAILABLE"
        : "DEPLOYMENT_CANCELLATION_DISABLED",
  });
  expect(h.fetcher).toHaveBeenCalledTimes(2);
});
it("requires rollback timestamp and supports cancel reason", async () => {
  for (const available of [false, true]) {
    const h = harness([
      token,
      available
        ? { databaseRollbackRestoreTimestamp: "2026-01-01T00:00:00Z" }
        : {},
      new Response(null, { status: 202 }),
    ]);
    const api = new DeploymentApi(
      {
        ...inputs(),
        rollbackDatabase: true,
        cancelReason: "Synthetic cancellation",
      },
      h.http,
      h.tokens,
    );
    if (available) {
      await api.cancel(id);
      expect(h.fetcher.mock.calls[2]![1].body).toContain("cancelReason");
    } else await expect(api.cancel(id)).rejects.toThrow();
  }
});
it("validates returned split", async () => {
  const split = { endpoints: [{ code: "synthetic", percentage: 10 }] };
  const h = harness([
    token,
    Response.json({ ...split, deploymentCode: id }, { status: 201 }),
  ]);
  await h.api.updateTraffic(id, split);
  expect(h.fetcher.mock.calls[1]![1].method).toBe("PUT");
});
it.each([
  null,
  [],
  { code: "wrong" },
  { code: id, buildCode: "a/b" },
  { code: id, strategy: 2 },
  { code: id, isCanaryAvailable: "true" },
  { code: id, subscriptionCode: "wrong" },
])("rejects malformed detail", async (body) => {
  const h = harness([token, Response.json(body)]);
  await expect(h.api.detail(id)).rejects.toThrow();
});
it.each([
  {},
  { deploymentStatus: "" },
  { deploymentStatus: "DEPLOYING", subscriptionCode: "wrong" },
  { deploymentStatus: "DEPLOYING", deploymentCode: "wrong" },
])("rejects malformed progress", async (body) => {
  const h = harness([token, body]);
  await expect(h.api.progress(id)).rejects.toThrow();
});
it.each([{}, { deploymentDecisions: [{}] }])(
  "rejects malformed history",
  async (body) => {
    const h = harness([token, body]);
    await expect(h.api.decisions(id)).rejects.toThrow();
  },
);
it.each([
  {},
  { decision: "REJECT" },
  { decision: "ACCEPT", newDeploymentCode: "a/b" },
])("invalid accepted decision is ambiguous", async (body) => {
  const h = harness([token, body]);
  await expect(h.api.decide(id, "ACCEPT")).rejects.toMatchObject({
    code: "DEPLOYMENT_DECISION_AMBIGUOUS",
  });
});
it.each([
  {},
  { endpoints: "bad" },
  { endpoints: [{ code: "synthetic", percentage: -1 }] },
  { endpoints: [{ code: "synthetic", percentage: 101 }] },
  { endpoints: [{ code: "synthetic", percentage: 1.5 }] },
])("malformed traffic confirmation is ambiguous", async (body) => {
  const h = harness([token, Response.json(body, { status: 201 })]);
  await expect(
    h.api.updateTraffic(id, {
      endpoints: [{ code: "synthetic", percentage: 10 }],
    }),
  ).rejects.toThrow();
});
it("includes decision reason and omits invalid percentage", async () => {
  const h = harness([
    token,
    { decision: "ACCEPT" },
    { deploymentStatus: "DEPLOYING", percentage: 101 },
  ]);
  const api = new DeploymentApi(
    { ...inputs(), decisionReason: "Synthetic reason" },
    h.http,
    h.tokens,
  );
  await api.decide(id, "ACCEPT");
  expect(h.fetcher.mock.calls[1]![1].body).toContain("reason");
  expect(await api.progress(id)).not.toHaveProperty("percentage");
});
it("stops after repeated unauthorized", async () => {
  const h = harness([
    token,
    Response.json({}, { status: 401 }),
    token,
    Response.json({}, { status: 401 }),
  ]);
  await expect(h.api.create()).rejects.toMatchObject({ httpStatus: 401 });
  expect(h.fetcher).toHaveBeenCalledTimes(4);
});
