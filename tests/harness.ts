import { vi } from "vitest";
import type { Runtime } from "../src/runtime.js";
import { DeployClient } from "../src/client.js";
import { DeploymentApi } from "../src/api.js";
import { Sanitizer } from "../src/security.js";
import { inputs } from "./fixtures.js";
export const token = {
  access_token: "FAKE_ACCESS_TOKEN",
  token_type: "Bearer",
  expires_in: 3600,
};
export function harness(items: (object | Error)[]) {
  let time = 0;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const x = items.shift();
    if (x instanceof Error) throw x;
    if (x instanceof Response) return x;
    return Response.json(x, {
      status: init.method === "POST" && !url.includes("oauth2") ? 201 : 200,
    });
  });
  const rt: Runtime = {
    fetch: ((url, init) =>
      fetcher(String(url), {
        ...init,
        headers: Object.fromEntries(new Headers(init?.headers)),
      })) as typeof fetch,
    now: () => time,
    sleep: vi.fn(async (ms) => {
      time += ms;
    }),
    random: () => 0,
  };
  const safe = new Sanitizer(vi.fn());
  const client = new DeployClient(
    rt,
    new AbortController().signal,
    inputs(),
    safe,
    () => {
      api.pollCount++;
    },
  );
  const tokens = client.tokens;
  const api = new DeploymentApi(inputs(), client);
  return {
    rt,
    safe,
    client,
    tokens,
    api,
    fetcher,
    advance: (ms: number) => (time += ms),
  };
}
