import { it, expect } from "vitest";
import { readInputs, trafficSplit } from "../src/inputs.js";
import { Sanitizer } from "../src/security.js";
import { raw } from "./fixtures.js";
const read = (v: Record<string, string>) =>
  readInputs((n) => v[n] ?? "", new Sanitizer(() => {}));
const existing = (operation: string) => {
  const v = { ...raw, operation, "deployment-code": "synthetic-deploy" };
  for (const k of [
    "build-code",
    "environment-code",
    "strategy",
    "database-update-mode",
  ])
    delete (v as Record<string, string>)[k];
  return v;
};
it.each(["resume", "cancel", "decide"])("validates %s", (op) => {
  const v = existing(op);
  expect(
    read({ ...v, ...(op === "decide" ? { "green-decision": "ACCEPT" } : {}) })
      .operation,
  ).toBe(op);
  expect(() => read({ ...v, "deployment-code": "" })).toThrow();
});
it.each([
  ["operation", "unknown"],
  ["strategy", "green"],
  ["database-update-mode", "none"],
  ["deployment-code", "synthetic"],
  ["green-decision", "ACCEPT"],
  ["decision-reason", "reason"],
  ["rollback-database", "true"],
  ["cancel-reason", "reason"],
  ["wait-for-completion", "false"],
  ["validate-deployment-modes", "yes"],
  ["traffic-split-json", "{}"],
])("rejects invalid combination %s", (k, v) =>
  expect(() => read({ ...raw, [k!]: v! })).toThrow(),
);
it.each([
  {},
  [],
  { endpoints: [{ code: "synthetic", percentage: 101 }] },
  { endpoints: [{ code: "https://invalid", percentage: 10 }] },
  { services: [{ code: "synthetic", percentage: 1.2 }] },
  { services: [{ code: "synthetic", percentage: 1, extra: "x" }] },
  { metadata: {} },
  { services: Array(51).fill({ code: "synthetic", percentage: 1 }) },
])("rejects unsafe split", (v) =>
  expect(() => trafficSplit(JSON.stringify(v))).toThrow(),
);
it("rejects oversized and malformed JSON", () => {
  expect(() => trafficSplit("x".repeat(32769))).toThrow();
  expect(() => trafficSplit("{")).toThrow();
});
it.each(["endpoints", "services"])("accepts %s split", (key) =>
  expect(
    trafficSplit(
      JSON.stringify({ [key]: [{ code: "synthetic", percentage: 0 }] }),
    ),
  ).toHaveProperty(key),
);
it("accepts canary and rejects invalid cancel reason", () => {
  expect(
    read({
      ...existing("decide"),
      "green-decision": "PREPARE_CANARY",
      "traffic-split-json":
        '{"endpoints":[{"code":"synthetic","percentage":10}]}',
      "wait-for-completion": "false",
    }).trafficSplit,
  ).toEqual({ endpoints: [{ code: "synthetic", percentage: 10 }] });
  expect(() =>
    read({ ...existing("cancel"), "cancel-reason": "bad" }),
  ).toThrow();
});
