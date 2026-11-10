import { describe, it, expect, vi } from "vitest";
import { readInputs, httpsUrl, segment } from "../src/inputs.js";
import { Sanitizer, escapeHtml } from "../src/security.js";
import { raw, inputs } from "./fixtures.js";
describe("inputs and URL validation", () => {
  it("reads defaults and masks before validation", () => {
    const mask = vi.fn();
    expect(inputs()).toMatchObject({
      pollIntervalMs: 60000,
      timeoutMs: 14400000,
    });
    expect(() =>
      readInputs(
        (n) => (n === "build-code" ? "" : (raw[n] ?? "")),
        new Sanitizer(mask),
      ),
    ).toThrow();
    expect(mask).toHaveBeenCalledTimes(4);
  });
  it.each([
    "http://example.invalid",
    "https://u:p@example.invalid",
    "https://example.invalid/#x",
    "https://example.invalid/?x=1",
    "https://example.invalid/\n",
    "not-url",
    "https://example.invalid/\\x",
    "x".repeat(2049),
  ])("rejects unsafe URL %s", (v) => expect(() => httpsUrl(v)).toThrow());
  it.each(["a/b", "a\\b", "a?b", "a#b", ".", "..", ""])(
    "rejects path %s",
    (v) => expect(() => segment(v)).toThrow(),
  );
  it("encodes segment", () => expect(segment("a b")).toBe("a%20b"));
  it.each([
    ["build-code", "x".repeat(301)],
    ["environment-code", ""],
    ["client-id", "\u0000"],
    ["poll-interval-seconds", "9"],
    ["poll-interval-seconds", "601"],
    ["poll-interval-seconds", "10.5"],
    ["timeout-minutes", "0"],
    ["timeout-minutes", "1441"],
  ])("rejects invalid %s", (k, v) =>
    expect(() =>
      readInputs(
        (n) => (n === k ? v! : (raw[n] ?? "")),
        new Sanitizer(() => {}),
      ),
    ).toThrow(),
  );
  it("sanitizes secrets and markup", () => {
    const s = new Sanitizer(() => {});
    s.add("FAKE_SECRET");
    s.add("");
    expect(
      s.text("<b>FAKE_SECRET</b> Bearer abc https://example.invalid/\n"),
    ).not.toMatch(/FAKE_SECRET|abc|<b>|https/);
    expect(s.contains("FAKE_SECRET")).toBe(true);
    expect(escapeHtml("<&>\"'")).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});
it.each(["https://example.invalid/?", "https://example.invalid/#"])(
  "rejects even empty query or fragment delimiter %s",
  (v) => expect(() => httpsUrl(v)).toThrow(),
);
it("masks each sensitive input immediately before reading the next", () => {
  const calls: string[] = [];
  expect(() =>
    readInputs(
      (name) => {
        calls.push(name);
        if (name === "client-secret") throw Error("read failed");
        return raw[name] ?? "";
      },
      new Sanitizer((value) => {
        calls.push("masked:" + value);
      }),
    ),
  ).toThrow("read failed");
  expect(calls).toEqual([
    "token-endpoint",
    "masked:" + raw["token-endpoint"],
    "client-id",
    "masked:" + raw["client-id"],
    "client-secret",
  ]);
});
it.each([
  "<<script>script>alert(1)</script>",
  "<script",
  ">text<",
  "<b>safe</b>",
])("removes all markup delimiters from malformed provider text %s", (value) => {
  const safe = new Sanitizer(() => {});
  expect(safe.text(value)).not.toMatch(/[<>]/);
});
