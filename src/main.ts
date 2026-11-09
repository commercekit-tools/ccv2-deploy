import * as core from "@actions/core";
import { run } from "./action.js";
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
void run(core, undefined, process.env, controller.signal)
  .catch(() => core.setFailed("The Action encountered an internal error."))
  .finally(() => {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  });
