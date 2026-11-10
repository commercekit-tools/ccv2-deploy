import * as core from "@actions/core";
import { credentials, request } from "./common.mjs";
try {
  if (process.env.RUN_ID) {
    const run = credentials();
    await request(
      `/sandbox/v1/runs/${run}`,
      "DELETE",
      process.env.CONTROL_TOKEN,
    );
    core.info("Disposable Sandbox run deleted.");
  }
} catch {
  core.setFailed(
    "Sandbox cleanup failed. The disposable run may remain until its expiration.",
  );
}
