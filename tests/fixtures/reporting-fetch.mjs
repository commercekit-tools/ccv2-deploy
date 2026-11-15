import { writeFileSync } from "node:fs";

// Keep scenario values separate from executable preload source.
const scenario = process.env.COMMERCEKIT_TEST_DEPLOY_STATUS;
if (
  !new Set([
    "DEPLOYED",
    "FAIL",
    "UNDEPLOYED",
    "FUTURE",
    "handoff",
    "invalid",
  ]).has(scenario)
)
  throw new Error("Unexpected synthetic deployment scenario.");
const handoff = scenario === "handoff";

let requests = 0;
process.once("exit", () =>
  writeFileSync(new URL("./requests", import.meta.url), String(requests)),
);
globalThis.fetch = async (url, init) => {
  requests++;
  url = String(url);
  if (
    ![
      "https://auth.example.invalid",
      "https://portalapi.commerce.ondemand.com",
    ].includes(new URL(url).origin)
  )
    throw new Error("Unexpected network destination");
  if (init.redirect !== "error") throw new Error("Unsafe redirects");
  if (url.includes("oauth2"))
    return Response.json({
      access_token: "SYNTHETIC_BUNDLE_TOKEN",
      token_type: "Bearer",
    });
  if (init.method === "POST")
    return Response.json({ code: "synthetic.1" }, { status: 201 });
  if (url.endsWith("/progress"))
    return Response.json({
      deploymentStatus: handoff ? "DEPLOYING" : scenario,
      percentage: 90,
    });
  if (url.endsWith("/decisions"))
    return Response.json({ deploymentDecisions: [] });
  return Response.json({
    code: "synthetic.1",
    status: "DEPLOYING",
    strategy: handoff ? "GREEN" : "ROLLING_UPDATE",
    isCanaryAvailable: handoff,
    canaryStatus: "STARTED",
    expireAtTimestamp: "2099-01-01T00:00:00Z",
  });
};
