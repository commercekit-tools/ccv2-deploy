import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
it("executes bundled Action with synthetic fetch and GitHub output files", () => {
  const dir = mkdtempSync(join(tmpdir(), "ccv2-test-"));
  try {
    const preload = join(dir, "fetch.cjs");
    writeFileSync(
      preload,
      `global.fetch=async (url,init)=>{url=String(url);if(init.redirect!=='error')throw Error('redirect policy');if(url.includes('oauth2'))return Response.json({access_token:'FAKE_BUNDLE_TOKEN',token_type:'Bearer'});if(init.method==='POST')return Response.json({code:'synthetic.1'},{status:201});if(url.endsWith('/progress'))return Response.json({deploymentStatus:'DEPLOYED',percentage:100});return Response.json({code:'synthetic.1'});};`,
    );
    const out = join(dir, "outputs"),
      summary = join(dir, "summary");
    writeFileSync(out, "");
    writeFileSync(summary, "");
    const result = spawnSync(
      process.execPath,
      ["--require", preload, resolve("dist/index.js")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          INPUT_TOKEN_ENDPOINT: "",
          "INPUT_TOKEN-ENDPOINT": "https://auth.example.invalid/oauth2/token",
          "INPUT_CLIENT-ID": "FAKE_BUNDLE_CLIENT",
          "INPUT_CLIENT-SECRET": "FAKE_BUNDLE_SECRET",
          INPUT_RESOURCE: "FAKE_BUNDLE_RESOURCE",
          "INPUT_SUBSCRIPTION-CODE": "synthetic-subscription",
          "INPUT_VALIDATE-DEPLOYMENT-MODES": "false",
          "INPUT_ENVIRONMENT-CODE": "synthetic-env",
          "INPUT_DATABASE-UPDATE-MODE": "NONE",
          INPUT_STRATEGY: "ROLLING_UPDATE",
          "INPUT_BUILD-CODE": "synthetic-build",
          GITHUB_OUTPUT: out,
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("ccv2.deployment.completed");
    expect(readFileSync(out, "utf8")).not.toContain("FAKE_BUNDLE_TOKEN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
