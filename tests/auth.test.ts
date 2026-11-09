import { it, expect, describe, vi } from "vitest";
import { Http, retryAfter } from "../src/http.js";

import { inputs } from "./fixtures.js";
import { harness, token } from "./harness.js";
describe("technical-user authentication", () => {
  it("encodes form, masks token, uses HTTPS without redirects", async () => {
    const h = harness([token]);
    expect(await h.tokens.get()).toBe(token.access_token);
    const [url, init] = h.fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(inputs().tokenEndpoint);
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
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
    await h.tokens.get();
    await h.tokens.get();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.advance(3540001);
    await h.tokens.get();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
  it("missing expiry reuses until explicit refresh; lowercase Bearer accepted", async () => {
    const h = harness([
      { ...token, expires_in: undefined, token_type: "bearer" },
      token,
    ]);
    await h.tokens.get();
    h.advance(1e9);
    await h.tokens.get();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await h.tokens.get(true);
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
    await expect(h.tokens.get()).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
    });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403])("does not retry permanent %i", async (status) => {
    const h = harness([
      Response.json({ error: "invalid_resource" }, { status }),
    ]);
    await expect(h.tokens.get()).rejects.toMatchObject({
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
    await h.tokens.get();
    expect(h.http.retryCount).toBe(1);
    expect(h.rt.sleep).toHaveBeenCalledWith(2000, h.http.signal);
  });
  it("retries network, stops at three", async () => {
    const h = harness([
      new Error("secret"),
      new Error("secret"),
      new Error("secret"),
    ]);
    await expect(h.tokens.get()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
    });
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });
  it("normalizes exhausted token HTTP errors", async () => {
    const h = harness(
      Array.from({ length: 3 }, () => Response.json({}, { status: 503 })),
    );
    await expect(h.tokens.get()).rejects.toMatchObject({
      code: "TOKEN_REQUEST_FAILED",
    });
  });
});
it("parses Retry-After seconds/date and invalid values", () => {
  expect(retryAfter("3")).toBe(3000);
  expect(retryAfter("Thu, 01 Jan 1970 00:00:02 GMT", 0)).toBe(2000);
  expect(retryAfter("bad")).toBe(0);
  expect(retryAfter(null)).toBe(0);
});
it("rejects malformed, oversized, and non-object successful bodies", async () => {
  for (const body of ["bad", "null", '"text"', "x".repeat(262145)]) {
    const h = harness([new Response(body)]);
    await expect(
      h.http.once("https://example.invalid", {}),
    ).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  }
});
it("does not expose non-JSON error response", async () => {
  const h = harness([new Response("secret", { status: 400 })]);
  expect((await h.http.once("https://example.invalid", {})).body).toEqual({});
});
it("honors cancellation before network", async () => {
  const h = harness([]);
  const a = new AbortController();
  a.abort();
  const http = new Http(h.rt, a.signal);
  await expect(http.once("https://example.invalid", {})).rejects.toThrow();
  expect(h.fetcher).not.toHaveBeenCalled();
});
it("production runtime delegates fetch, monotonic clock, and abortable timers", async () => {
  const { runtime } = await import("../src/http.js");
  const mocked = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({}));
  expect(runtime.now()).toBeGreaterThanOrEqual(0);
  await runtime.fetch("https://example.invalid");
  expect(mocked).toHaveBeenCalledOnce();
  await runtime.sleep(1, new AbortController().signal);
  mocked.mockRestore();
});
it("handles bodyless errors and non-object error JSON", async () => {
  for (const r of [
    new Response(null, { status: 403 }),
    Response.json(null, { status: 400 }),
  ]) {
    const h = harness([r]);
    expect((await h.http.once("https://example.invalid", {})).body).toEqual({});
  }
});
it("times out a pending request after 30 seconds without exposing transport errors", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    const h = harness([]);
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) => {
        const a = new AbortController();
        setTimeout(() => a.abort(), ms);
        return a.signal;
      });
    h.rt.fetch = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init!.signal!.addEventListener("abort", () =>
            reject(Error("FAKE_TRANSPORT_SECRET")),
          ),
        ),
    );
    const pending = h.http.once("https://example.invalid", {});
    const assertion = expect(pending).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      message: "The API request could not be completed.",
    });
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
    timeout.mockRestore();
  } finally {
    vi.useRealTimers();
  }
});
