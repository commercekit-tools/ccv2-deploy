import { it, expect, describe, vi } from "vitest";
import { DeployClient } from "../src/client.js";

import { inputs } from "./fixtures.js";
import { harness, token } from "./harness.js";
describe("technical-user authentication", () => {
  it("encodes form, masks token, uses HTTPS without redirects", async () => {
    const h = harness([token]);
    expect(await h.client.authenticate()).toBe(token.access_token);
    const [url, init] = h.fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(inputs().tokenEndpoint);
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    });
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      client_id: "FAKE_CLIENT_ID",
      client_secret: "FAKE_CLIENT_SECRET",
      resource: "FAKE_RESOURCE",
      grant_type: "client_credentials",
    });
    expect(h.safe.contains(token.access_token)).toBe(true);
  });
  it("reuses and proactively refreshes", async () => {
    const h = harness([token, token]);
    await h.client.authenticate();
    await h.client.authenticate();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.advance(3540001);
    await h.client.authenticate();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
  it("missing expiry reuses until explicit refresh; lowercase Bearer accepted", async () => {
    const h = harness([
      { ...token, expires_in: undefined, token_type: "bearer" },
      token,
    ]);
    await h.client.authenticate();
    h.advance(1e9);
    await h.client.authenticate();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.tokens.invalidate();
    await h.client.authenticate();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    {},
    { ...token, access_token: "" },
    { ...token, access_token: "a b" },
    { ...token, token_type: "Basic" },
    { ...token, expires_in: 0 },
    { ...token, expires_in: 1.5 },
  ])("rejects malformed token", async (t) => {
    const h = harness([t]);
    await expect(h.client.authenticate()).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
    });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403])("does not retry permanent %i", async (status) => {
    const h = harness([
      Response.json({ error: "invalid_resource" }, { status }),
    ]);
    await expect(h.client.authenticate()).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      httpStatus: status,
    });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([429, 500, 502, 503, 504])("retries transient %i", async (status) => {
    const h = harness([
      Response.json({}, { status, headers: { "Retry-After": "2" } }),
      token,
    ]);
    await h.client.authenticate();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.rt.sleep).toHaveBeenCalledWith(2000, h.client.signal);
  });
  it("retries network, stops at three", async () => {
    const h = harness([
      new Error("secret"),
      new Error("secret"),
      new Error("secret"),
    ]);
    await expect(h.client.authenticate()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
    });
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });
  it("normalizes exhausted token HTTP errors", async () => {
    const h = harness(
      Array.from({ length: 3 }, () => Response.json({}, { status: 503 })),
    );
    await expect(h.client.authenticate()).rejects.toMatchObject({
      code: "TOKEN_REQUEST_FAILED",
    });
  });
});
it("honors cancellation before network", async () => {
  const h = harness([]);
  const a = new AbortController();
  a.abort();
  const client = new DeployClient(h.rt, a.signal, inputs(), h.safe);
  await expect(client.authenticate()).rejects.toThrow();
  expect(h.fetcher).not.toHaveBeenCalled();
});
it("production runtime uses a monotonic clock and abortable timers", async () => {
  const { runtime } = await import("../src/runtime.js");
  expect(runtime.now()).toBeGreaterThanOrEqual(0);
  await runtime.sleep(1, new AbortController().signal);
});
it.each(["create", "decide", "cancel", "traffic"] as const)(
  "%s never retries a request timeout",
  async (op) => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const h = harness([token, ...(op === "cancel" ? [{}] : [])]);
      await h.client.authenticate();
      const original = h.rt.fetch;
      h.rt.fetch = vi.fn((url, init) =>
        String(url).endsWith("/cancellationoptions")
          ? original(url, init)
          : new Promise<Response>((_resolve, reject) =>
              init!.signal!.addEventListener("abort", () =>
                reject(Error("FAKE_TRANSPORT_SECRET")),
              ),
            ),
      );
      const pending =
        op === "create"
          ? h.api.create()
          : op === "decide"
            ? h.api.decide("synthetic-deploy", "ACCEPT")
            : op === "cancel"
              ? h.api.cancel("synthetic-deploy")
              : h.api.updateTraffic("synthetic-deploy", {});
      const assertion = expect(pending).rejects.toMatchObject({
        code: expect.stringMatching(/AMBIGUOUS$/),
      });
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;
      expect(h.rt.fetch).toHaveBeenCalledTimes(op === "cancel" ? 2 : 1);
    } finally {
      vi.useRealTimers();
    }
  },
);
