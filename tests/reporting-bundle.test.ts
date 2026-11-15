import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { parseNotificationEventJson } from "@commercekit-tools/notification-contract";
import { inputDefinitions } from "../src/reporting.js";

const scenarios = [
  ["DEPLOYED", "success", 0, "✅"],
  ["FAIL", "failure", 1, "❌"],
  ["UNDEPLOYED", "cancelled", 1, "⏹️"],
  ["FUTURE", "internal-error", 1, "❌"],
  ["handoff", "action-required", 0, "⚠️"],
  ["invalid", "internal-error", 1, "❌"],
] as const;
function parseOutputs(text: string): Record<string, string> {
  const lines = text.split("\n");
  const values: Record<string, string> = {};
  for (let index = 0; index < lines.length; index++) {
    const [name, delimiter] = lines[index]!.split("<<");
    if (!delimiter) continue;
    const body = [];
    while (++index < lines.length && lines[index] !== delimiter)
      body.push(lines[index]);
    values[name!] = body.join("\n");
  }
  return values;
}
it.each(scenarios)(
  "bundled deployment %s writes consistent masked event, outputs and job summary",
  (status, expected, exit, icon) => {
    const dir = mkdtempSync(join(tmpdir(), "ccv2-deploy-report-"));
    try {
      const outputPath = join(dir, "output");
      const summaryPath = join(dir, "summary");
      const requestsPath = join(dir, "requests");
      const preload = join(dir, "fetch.cjs");
      writeFileSync(outputPath, "");
      writeFileSync(summaryPath, "");
      writeFileSync(
        preload,
        `const fs=require('node:fs');let requests=0;process.once('exit',()=>fs.writeFileSync(${JSON.stringify(requestsPath)},String(requests)));global.fetch=async(url,init)=>{requests++;url=String(url);if(!['https://auth.example.invalid','https://portalapi.commerce.ondemand.com'].includes(new URL(url).origin))throw Error('Unexpected network destination');if(init.redirect!=='error')throw Error('Unsafe redirects');if(url.includes('oauth2'))return Response.json({access_token:'SYNTHETIC_BUNDLE_TOKEN',token_type:'Bearer'});if(init.method==='POST')return Response.json({code:'synthetic.1'},{status:201});if(url.endsWith('/progress'))return Response.json({deploymentStatus:${JSON.stringify(status === "handoff" ? "DEPLOYING" : status)},percentage:90});if(url.endsWith('/decisions'))return Response.json({deploymentDecisions:[]});return Response.json({code:'synthetic.1',status:'DEPLOYING',strategy:${JSON.stringify(status === "handoff" ? "GREEN" : "ROLLING_UPDATE")},isCanaryAvailable:${status === "handoff"},canaryStatus:'STARTED',expireAtTimestamp:'2099-01-01T00:00:00Z'});};`,
      );
      copyFileSync("dist/index.js", join(dir, "index.js"));
      copyFileSync("dist/package.json", join(dir, "package.json"));
      const child = spawnSync(
        process.execPath,
        ["--require", preload, join(dir, "index.js")],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 10000,
          env: {
            ...process.env,
            NODE_AUTH_TOKEN: "",
            GITHUB_TOKEN: "",
            GH_TOKEN: "",
            NODE_PATH: "",
            "INPUT_TOKEN-ENDPOINT": "https://auth.example.invalid/oauth2/token",
            "INPUT_CLIENT-ID": "SYNTHETIC_BUNDLE_CLIENT",
            "INPUT_CLIENT-SECRET": "SYNTHETIC_BUNDLE_SECRET",
            INPUT_RESOURCE: "SYNTHETIC_BUNDLE_RESOURCE",
            "INPUT_SUBSCRIPTION-CODE": "synthetic-subscription",
            "INPUT_BUILD-CODE": status === "invalid" ? "" : "synthetic-build",
            "INPUT_ENVIRONMENT-CODE": "synthetic-env",
            "INPUT_DATABASE-UPDATE-MODE": "NONE",
            INPUT_STRATEGY: status === "handoff" ? "GREEN" : "ROLLING_UPDATE",
            "INPUT_VALIDATE-DEPLOYMENT-MODES": "false",
            "INPUT_POLL-INTERVAL-SECONDS": "10",
            "INPUT_TIMEOUT-MINUTES": "1",
            GITHUB_OUTPUT: outputPath,
            GITHUB_STEP_SUMMARY: summaryPath,
            GITHUB_REPOSITORY: "synthetic/example",
            GITHUB_RUN_ID: "123",
          },
        },
      );
      expect(child.status, child.stderr).toBe(exit);
      const outputs = parseOutputs(readFileSync(outputPath, "utf8"));
      const event = parseNotificationEventJson(outputs["notification-event"]!);
      if (
        event.eventType !== "ccv2.deployment.completed" &&
        event.eventType !== "ccv2.deployment.action-required"
      )
        throw Error("Expected deployment event.");
      expect(event.status).toBe(expected);
      expect(event.data.inputsValidated).toBe(status !== "invalid");
      expect(Object.keys(event.data.inputs!).sort()).toEqual(
        inputDefinitions.map((input) => input.name).sort(),
      );
      expect(JSON.parse(outputs["result-json"]!).inputs).toEqual(
        event.data.inputs,
      );
      const summary = readFileSync(summaryPath, "utf8");
      expect(summary).toContain(`## ${icon} CCv2 Deploy`);
      for (const value of [
        "### Result",
        "### Inputs",
        "| Input | Value |",
        "View workflow",
      ])
        expect(summary).toContain(value);
      for (const { name } of inputDefinitions) expect(summary).toContain(name);
      if (expected !== "success")
        expect(summary).toContain("| Code | Detail |");
      const sinks =
        outputs["notification-event"]! +
        outputs["result-json"]! +
        summary +
        child.stdout +
        child.stderr;
      for (const value of [
        "SYNTHETIC_BUNDLE_CLIENT",
        "SYNTHETIC_BUNDLE_SECRET",
        "SYNTHETIC_BUNDLE_RESOURCE",
        "SYNTHETIC_BUNDLE_TOKEN",
        "https://auth.example.invalid/oauth2/token",
      ]) {
        // GitHub's add-mask command intentionally contains the secret for runner masking.
        expect(
          outputs["notification-event"]! + outputs["result-json"]! + summary,
        ).not.toContain(value);
      }
      expect(sinks).not.toContain("Unexpected network destination");
      if (status === "invalid")
        expect(readFileSync(requestsPath, "utf8")).toBe("0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
