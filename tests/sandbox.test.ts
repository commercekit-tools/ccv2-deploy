import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
function prepare(scenario: string, fault = "") {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-mock-"));
  try {
    const out = join(dir, "out"),
      log = join(dir, "requests"),
      preload = join(dir, "mock.cjs");
    writeFileSync(out, "");
    writeFileSync(
      preload,
      `
      const fs=require('fs');
      global.fetch=async(url,init)=>{
        url=String(url);
        if(new URL(url).origin!=='https://ccv2.sandbox.commercekit.tools'||init.redirect!=='error')throw Error('Unexpected target');
        fs.appendFileSync(process.env.TEST_LOG,JSON.stringify({url,method:init.method,body:init.body})+'\\n');
        if(url.endsWith('/oauth2/token'))return Response.json({access_token:'FAKE_ACCESS_TOKEN',token_type:'Bearer'});
        if(url.includes('/v2/')&&(new Headers(init.headers).get('x-approuter-authorization')!=='Bearer FAKE_ACCESS_TOKEN'||new Headers(init.headers).has('Authorization')))throw Error('Management auth');
        if(url.endsWith('/builds')){
          if(process.env.TEST_FAULT==='network')throw Error('FAKE_UNKNOWN_TRANSPORT_SECRET');
          if(process.env.TEST_FAULT==='invalid-json')return new Response('invalid',{status:201,headers:{'content-type':'application/json'}});
          if(process.env.TEST_FAULT)return Response.json({detail:'FAKE_UNKNOWN_TRANSPORT_SECRET'},{status:Number(process.env.TEST_FAULT)});
          return Response.json({code:'20260101.1'},{status:201});
        }
        if(url.endsWith('/progress'))return Response.json({buildStatus:'SUCCESS'});
        if(url.endsWith('/environments'))return Response.json({value:[{code:'synthetic-env'}]});
        if(url.endsWith('/deployments'))return Response.json({code:'700001'},{status:201});
        return Response.json(init.method==='POST'?{runId:'run_'+'a'.repeat(32),controlToken:'FAKE_CONTROL',credentials:{clientId:'FAKE_CLIENT',clientSecret:'FAKE_SECRET',resource:'FAKE_RESOURCE',tokenUrl:'https://ccv2.sandbox.commercekit.tools/oauth2/token'}}:{});
      };
    `,
    );
    const result = spawnSync(
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
          TEST_FAULT: fault,
        },
      },
    );
    return {
      result,
      outputs: readFileSync(out, "utf8"),
      calls: readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
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
  "prepares %s with shared authentication and always publishes cleanup details",
  (scenario) => {
    const { result, outputs, calls } = prepare(scenario);
    expect(result.status, result.stderr).toBe(0);
    expect(outputs).toContain("control-token");
    expect(outputs).not.toContain("FAKE_ACCESS_TOKEN");
    expect(calls).toHaveLength(scenario === "cancel" ? 7 : 6);
    const config = JSON.parse(calls[1].body);
    expect(config.build.outcome).toBe("SUCCESS");
    if (scenario === "create-error")
      expect(config.faults[0]).toMatchObject({
        operationId: "createDeployment",
        status: 500,
        onCalls: [1],
      });
    expect(result.stdout).toContain("::add-mask::FAKE_SECRET");
    expect(result.stdout).toContain("::add-mask::FAKE_ACCESS_TOKEN");
    expect(Object.fromEntries(new URLSearchParams(calls[2].body))).toEqual({
      client_id: "FAKE_CLIENT",
      client_secret: "FAKE_SECRET",
      resource: "FAKE_RESOURCE",
      grant_type: "client_credentials",
    });
  },
);
it.each(["network", "429", "503", "invalid-json"])(
  "does not retry ambiguous Sandbox prerequisite creation (%s)",
  (fault) => {
    const { result, outputs, calls } = prepare("rolling-success", fault);
    expect(result.status).toBe(1);
    expect(calls.filter((call) => call.url.endsWith("/builds"))).toHaveLength(
      1,
    );
    expect(outputs).toContain("run-id");
    expect(outputs).toContain("control-token");
    expect(outputs + result.stdout + result.stderr).not.toContain(
      "FAKE_UNKNOWN_TRANSPORT_SECRET",
    );
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
