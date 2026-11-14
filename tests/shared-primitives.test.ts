import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { segment } from "../src/inputs.js";
import { Sanitizer } from "../src/security.js";

// Frozen from the pre-extraction Action; the package has the full provenance audit.
const fixtures: {
  text: { value: string; secrets: string[]; max: number; expected: string }[];
  paths: { value: string; accepted: boolean; encoded?: string }[];
} = JSON.parse(readFileSync("tests/fixtures/shared-primitives.json", "utf8"));
describe("shared primitive integration", () => {
  fixtures.text.forEach((fixture, index) => {
    it(`preserves sanitization case ${index}`, () => {
      const safe = new Sanitizer(() => {});
      fixture.secrets.forEach((secret) => safe.add(secret));
      expect(safe.text(fixture.value, fixture.max)).toBe(fixture.expected);
    });
  });
  fixtures.paths.forEach((fixture, index) => {
    it(`preserves path case ${index}`, () => {
      if (fixture.accepted)
        expect(segment(fixture.value)).toBe(fixture.encoded);
      else expect(() => segment(fixture.value)).toThrow();
    });
  });
  it("preserves public path diagnostics and Unicode failure classification", () => {
    expect(() => segment("")).toThrow("Invalid path identifier input.");
    expect(() => segment("a/b")).toThrow("Invalid path identifier.");
    expect(() => segment("\ud800")).toThrow(URIError);
    expect(() => segment("/\ud800")).toThrow("Invalid path identifier.");
  });
});
