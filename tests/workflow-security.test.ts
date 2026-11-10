import { readFileSync, readdirSync } from "node:fs";
import { it, expect } from "vitest";
const read = (p: string) => readFileSync(p, "utf8");
it("pins all external Actions and forbids privileged triggers, artifacts, and releases", () => {
  for (const file of readdirSync(".github/workflows")) {
    const s = read(".github/workflows/" + file);
    for (const [, ref] of s.matchAll(/uses:\s+(\S+)/g))
      if (ref !== "./") expect(ref).toMatch(/@[a-f0-9]{40}$/);
    expect(s).not.toMatch(
      /pull_request_target|upload-artifact|secrets\.(?!GITHUB_TOKEN)|git tag|gh release/,
    );
    expect(s).toContain("contents: read");
    expect(s).toContain("timeout-minutes:");
  }
});
it("limits Sandbox mutations to manual constrained workflow", () => {
  const s = read(".github/workflows/sandbox-smoke.yml");
  expect(s).toContain("workflow_dispatch:");
  expect(s).not.toMatch(/pull_request:|push:|schedule:|release:/);
  for (const scenario of [
    "rolling-success",
    "rolling-failure",
    "nonterminating",
    "rate-limit",
    "create-error",
    "green-manual",
    "green-accept",
    "green-prepare-canary",
    "green-reject",
    "cancel",
  ])
    expect(s).toContain(scenario);
  expect(s).toContain("RUN-COMMERCEKIT-SANDBOX-DEPLOY");
  expect(s).toContain("cancel-in-progress: false");
  expect(s).toContain("if: ${{ always() }}");
  expect(s).toContain("api-base-url: https://ccv2.sandbox.commercekit.tools");
  expect(s).toContain("uses: ./");
  expect(read("scripts/sandbox/prepare.mjs")).toContain(
    "RUN-COMMERCEKIT-SANDBOX-DEPLOY",
  );
});
it("CI is offline for contracts and never invokes Sandbox scripts", () => {
  const s = read(".github/workflows/ci.yml");
  expect(s).not.toMatch(/sandbox|oauth|secrets\.(?!GITHUB_TOKEN)/);
  expect(s).toContain("pnpm quality");
  const p = JSON.parse(read("package.json"));
  expect(p.scripts.quality).not.toContain("update");
  expect(p.private).toBe(true);
  expect(p.packageManager).toBe("pnpm@12.6.0");
});
it("metadata contains exactly approved inputs and outputs and node24", () => {
  const s = read("action.yml");
  const keys = (text: string) =>
    [...text.matchAll(/^ {2}([\w-]+):$/gm)].map((m) => m[1]);
  expect(keys(s.split("inputs:")[1]!.split("outputs:")[0]!)).toEqual([
    "operation",
    "token-endpoint",
    "client-id",
    "client-secret",
    "resource",
    "subscription-code",
    "deployment-code",
    "build-code",
    "environment-code",
    "database-update-mode",
    "strategy",
    "validate-deployment-modes",
    "green-decision",
    "decision-reason",
    "traffic-split-json",
    "rollback-database",
    "cancel-reason",
    "wait-for-completion",
    "api-base-url",
    "poll-interval-seconds",
    "timeout-minutes",
  ]);
  expect(keys(s.split("outputs:")[1]!.split("runs:")[0]!)).toEqual([
    "operation",
    "deployment-code",
    "original-deployment-code",
    "build-code",
    "environment-code",
    "deployment-status",
    "deployment-percentage",
    "action-required",
    "decision",
    "poll-count",
    "duration-ms",
    "result-json",
    "notification-event",
  ]);
  expect(s).toContain("using: node24");
});

it("install steps use read-only GitHub Packages credentials", () => {
  for (const file of ["ci.yml", "sandbox-smoke.yml"]) {
    const s = read(".github/workflows/" + file);
    expect(s).toContain("packages: read");
    expect(s).not.toContain("packages: write");
    expect(s).toContain("registry-url: https://npm.pkg.github.com");
    expect(s).toContain('scope: "@commercekit-tools"');
    const installs = [
      ...s.matchAll(
        /- run: pnpm install --frozen-lockfile\n {8}env:\n {10}NODE_AUTH_TOKEN: \$\{\{ secrets.GITHUB_TOKEN \}\}/g,
      ),
    ];
    expect(installs.length).toBe(file === "ci.yml" ? 2 : 1);
    expect(s.match(/secrets\./g)?.length).toBe(installs.length);
  }
});
