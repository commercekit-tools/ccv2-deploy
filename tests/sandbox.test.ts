import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
it.each([
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
])(
  "prepares %s using only mocked Sandbox and always publishes cleanup details",
  (scenario) => {
    const dir = mkdtempSync(join(tmpdir(), "sandbox-mock-"));
    try {
      const out = join(dir, "out"),
        log = join(dir, "requests"),
        preload = join(dir, "mock.cjs");
      writeFileSync(out, "");
      writeFileSync(
        preload,
        `const fs=require('fs');global.fetch=async(url,init)=>{if(new URL(url).origin!=='https://ccv2.sandbox.commercekit.tools'||init.redirect!=='error')throw Error();fs.appendFileSync(process.env.TEST_LOG,JSON.stringify({url:String(url),method:init.method,body:init.body})+'\\n');if(String(url).endsWith('/oauth2/token'))return Response.json({access_token:'FAKE_ACCESS_TOKEN'});if(String(url).endsWith('/builds'))return Response.json({code:'20260101.1'});if(String(url).endsWith('/progress'))return Response.json({buildStatus:'SUCCESS'});if(String(url).endsWith('/environments'))return Response.json({value:[{code:'synthetic-env'}]});if(String(url).endsWith('/deployments'))return Response.json({code:'700001'});return Response.json(init.method==='POST'?{runId:'run_'+'a'.repeat(32),controlToken:'FAKE_CONTROL',credentials:{clientId:'FAKE_CLIENT',clientSecret:'FAKE_SECRET',resource:'FAKE_RESOURCE',tokenUrl:'https://ccv2.sandbox.commercekit.tools/oauth2/token'}}:{});};`,
      );
      const r = spawnSync(
        process.execPath,
        ["--require", preload, "scripts/sandbox/prepare.mjs"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            SCENARIO: scenario,
            CONFIRMATION: "RUN-COMMERCEKIT-SANDBOX-DEPLOY",
            GITHUB_OUTPUT: out,
            TEST_LOG: log,
          },
        },
      );
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(out, "utf8")).toContain("control-token");
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s));
      expect(calls).toHaveLength(scenario === "cancel" ? 7 : 6);
      const config = JSON.parse(calls[1].body);
      expect(config.build.outcome).toBe("SUCCESS");
      if (scenario === "create-error")
        expect(config.faults[0]).toMatchObject({
          operationId: "createDeployment",
          status: 500,
          onCalls: [1],
        });
      expect(r.stdout).toContain("::add-mask::FAKE_SECRET");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it("rejects invalid confirmation without network", () => {
  const r = spawnSync(process.execPath, ["scripts/sandbox/prepare.mjs"], {
    encoding: "utf8",
    env: { ...process.env, SCENARIO: "success", CONFIRMATION: "NO" },
  });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("Sandbox preparation failed");
});
it("cleanup is a no-op when no disposable run was created", () => {
  const r = spawnSync(process.execPath, ["scripts/sandbox/cleanup.mjs"], {
    encoding: "utf8",
    env: { ...process.env, RUN_ID: "" },
  });
  expect(r.status).toBe(0);
});
