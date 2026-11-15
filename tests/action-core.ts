import { vi } from "vitest";
import type { Core } from "../src/action.js";
import { raw } from "./fixtures.js";
import { validateNotificationEvent } from "@commercekit-tools/notification-contract";
export function fakeCore(overrides: Record<string, string> = {}) {
  const outputs: Record<string, string> = {};
  const calls: string[] = [];
  const summary = { addRaw: vi.fn(), write: vi.fn(async () => {}) };
  const core = {
    getInput: vi.fn((n: string) => overrides[n] ?? raw[n] ?? ""),
    setSecret: vi.fn(),
    setOutput: vi.fn((k: string, v: string) => {
      if (k === "notification-event" && v)
        validateNotificationEvent(JSON.parse(v));
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
