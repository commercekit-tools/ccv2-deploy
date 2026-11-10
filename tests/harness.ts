import { vi } from "vitest";
import { Http, type Runtime } from "../src/http.js";
import { TokenManager } from "../src/auth.js";
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
    fetch: fetcher as typeof fetch,
    now: () => time,
    sleep: vi.fn(async (ms) => {
      time += ms;
    }),
    random: () => 0,
  };
  const safe = new Sanitizer(vi.fn());
  const http = new Http(rt, new AbortController().signal);
  const tokens = new TokenManager(inputs(), http, safe);
  const api = new DeploymentApi(inputs(), http, tokens);
  return {
    rt,
    safe,
    http,
    tokens,
    api,
    fetcher,
    advance: (ms: number) => (time += ms),
  };
}
