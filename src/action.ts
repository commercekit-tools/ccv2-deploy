import type * as core from "@actions/core";
import {
  captureActionInputs,
  type SafeNotificationError,
} from "@commercekit-tools/notification-contract";
import { readInputs, type Inputs } from "./inputs.js";
import { Sanitizer } from "./security.js";
import { ActionError, waitTimeout } from "./errors.js";
import { runtime, type Runtime } from "./runtime.js";
import { DeployClient } from "./client.js";
import { DeploymentApi, decisionPoint } from "./api.js";
import { initialResult, type Result } from "./result.js";
import { event } from "./notification.js";
import { inputContext, inputDefinitions, summary } from "./reporting.js";
const maxStructuredOutputBytes = 65536;
export type Core = Pick<
  typeof core,
  "getInput" | "setSecret" | "setOutput" | "setFailed" | "info" | "warning"
> & { summary: Pick<typeof core.summary, "addRaw" | "write"> };
export async function run(
  core: Core,
  rt: Runtime = runtime,
  env: NodeJS.ProcessEnv = process.env,
  external?: AbortSignal,
) {
  const started = rt.now();
  const safe = new Sanitizer((v) => core.setSecret(v));
  let result = initialResult();
  let captured: Record<string, string> = {};
  let validated: Inputs | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let api: DeploymentApi | undefined;
  let activeSignal: AbortSignal | undefined;
  try {
    captured = captureActionInputs(
      inputDefinitions,
      (name) => core.getInput(name, { trimWhitespace: false }),
      (value) => safe.add(value),
    );
    const input = readInputs((name) => captured[name] ?? "", safe);
    validated = input;
    result.operation = input.operation;
    result.subscriptionCode = input.subscriptionCode;
    for (const key of [
      "buildCode",
      "environmentCode",
      "databaseUpdateMode",
      "strategy",
    ] as const)
      if (input[key]) result[key] = input[key];
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(waitTimeout()), input.timeoutMs);
    const signal = external
      ? AbortSignal.any([external, controller.signal])
      : controller.signal;
    activeSignal = signal;
    const deadline = started + input.timeoutMs;
    const check = () => {
      signal.throwIfAborted();
      if (rt.now() >= deadline) throw waitTimeout();
    };
    const client = new DeployClient(rt, signal, input, safe, () => {
      api!.pollCount++;
    });
    api = new DeploymentApi(input, client);
    core.info("Authenticating with the CCv2 technical user.");
    await client.authenticate();
    check();
    if (input.operation === "deploy") {
      if (input.validateDeploymentModes) {
        core.info("Validating deployment modes.");
        await api.modes();
        check();
      }
      core.info("Creating CCv2 deployment.");
      result.deploymentCode = await api.create();
    } else result.deploymentCode = input.deploymentCode!;
    result.originalDeploymentCode = result.deploymentCode;
    const readDetail = async () => {
      const detail = await api!.detail(result.deploymentCode!);
      for (const k of [
        "buildCode",
        "environmentCode",
        "databaseUpdateMode",
        "strategy",
      ] as const)
        if (detail[k]) result[k] = detail[k];
      if (detail.status && result.deploymentStatus === undefined)
        result.deploymentStatus = detail.status;
      if (
        result.strategy &&
        result.strategy !== "GREEN" &&
        input.greenDecision !== "MANUAL"
      )
        throw new ActionError(
          "INVALID_INPUT",
          "Green decisions require a GREEN deployment.",
        );
      return detail;
    };
    await readDetail();
    check();
    if (input.operation === "cancel") {
      await api.cancel(result.deploymentCode);
      result.cancellation = {
        requested: true,
        rollbackDatabase: input.rollbackDatabase,
      };
      check();
    }
    let previous = "";
    for (;;) {
      check();
      const progress = await api.progress(result.deploymentCode!);
      Object.assign(result, progress);
      check();
      const label =
        progress.deploymentStatus +
        (progress.percentage === undefined ? "" : ` (${progress.percentage}%)`);
      if (previous !== label) {
        core.info(`Deployment status: ${safe.text(label)}.`);
        previous = label;
      }
      if (
        ["DEPLOYED", "UNDEPLOYED", "FAIL"].includes(progress.deploymentStatus)
      ) {
        if (input.operation === "decide" && !result.decision)
          throw new ActionError(
            "DEPLOYMENT_DECISION_FAILED",
            "The deployment is terminal; no decision was submitted.",
          );
        await readDetail();
        result.outcome =
          progress.deploymentStatus === "DEPLOYED"
            ? "success"
            : progress.deploymentStatus === "FAIL"
              ? "failure"
              : "cancelled";
        if (result.outcome !== "success")
          result.error = {
            code:
              result.outcome === "failure"
                ? "DEPLOYMENT_FAILED"
                : "DEPLOYMENT_UNDEPLOYED",
            message: `Deployment finished with status ${progress.deploymentStatus}.`,
          };
        break;
      }
      if (!["SCHEDULED", "DEPLOYING"].includes(progress.deploymentStatus))
        throw new ActionError(
          "DEPLOYMENT_UNKNOWN_STATUS",
          "The API returned an undocumented deployment status.",
        );
      if (input.operation !== "cancel" && !result.decision) {
        const detail = await readDetail();
        if (detail.isCanaryAvailable === true || result.strategy === "GREEN") {
          const history = await api.decisions(result.deploymentCode!);
          if (decisionPoint(detail, progress, history)) {
            if (input.greenDecision === "MANUAL") {
              result.actionRequired = true;
              result.outcome = "action-required";
              core.info("Green deployment requires a decision.");
              break;
            }
            check();
            if (
              input.greenDecision === "PREPARE_CANARY" &&
              history.includes("PREPARE_CANARY")
            )
              throw new ActionError(
                "DEPLOYMENT_DECISION_FAILED",
                "Canary was already prepared; submit ACCEPT or REJECT.",
              );
            const next = await api.decide(
              result.deploymentCode!,
              input.greenDecision,
            );
            result.decision = input.greenDecision;
            if (next) {
              result.newDeploymentCode = next;
              result.deploymentCode = next;
            }
            if (input.greenDecision === "PREPARE_CANARY") {
              if (input.trafficSplit) {
                check();
                await api.updateTraffic(
                  result.deploymentCode!,
                  input.trafficSplit,
                );
                result.trafficSplit = { updated: true };
              }
              await readDetail();
              result.actionRequired = true;
              result.outcome = "action-required";
              break;
            }
          }
        }
      }
      await rt.sleep(
        Math.min(input.pollIntervalMs, Math.max(0, deadline - rt.now())),
        signal,
      );
    }
  } catch (error) {
    const failure = activeSignal?.aborted ? activeSignal.reason : error;
    const known =
      failure instanceof ActionError
        ? failure
        : external?.aborted
          ? new ActionError(
              "ACTION_CANCELLED",
              "The Action was interrupted. The remote deployment may still continue.",
            )
          : new ActionError(
              "INTERNAL_ERROR",
              "The Action encountered an internal error.",
            );
    result.error = {
      code: known.code,
      message: safe.text(known.message) || "The Action encountered an error.",
    };
    result.timedOut = known.code === "DEPLOYMENT_WAIT_TIMEOUT";
  } finally {
    if (timer) clearTimeout(timer);
  }
  result.pollCount = api?.pollCount ?? 0;

  result.durationMs = Math.max(0, Math.floor(rt.now() - started));
  // Sanitize untrusted data without changing locally selected semantic enums.
  const outcome = result.outcome;
  const operation = result.operation;
  result = JSON.parse(
    JSON.stringify(result, (_key, value: unknown) =>
      typeof value === "string" ? safe.text(value) : value,
    ),
  ) as Result;
  result.outcome = outcome;
  result.operation = operation;
  try {
    Object.assign(result, inputContext(captured, validated, safe));
  } catch {
    core.warning(
      "The input summary could not be prepared; the Action result is preserved.",
    );
  }
  if (result.outcome === "action-required")
    result.issues = [
      {
        code: "deployment-action-required",
        message:
          "The deployment requires a further manual or canary decision. Review its current state before continuing.",
      },
    ];
  const outputFailure = await emit(core, result, safe, env);
  if (!["success", "action-required"].includes(result.outcome))
    core.setFailed(result.error?.message ?? "CCv2 deployment did not succeed.");
  else if (outputFailure)
    core.setFailed("Action result outputs could not be written.");
  else
    core.info(
      result.actionRequired
        ? "Deployment requires a further decision."
        : "Deployment completed successfully.",
    );
  return result;
}
async function emit(
  core: Core,
  result: Result,
  safe: Sanitizer,
  env: NodeJS.ProcessEnv,
) {
  const reportingIssues: SafeNotificationError[] = [];
  let eventJson: string;
  try {
    eventJson = JSON.stringify(event(result, env, safe));
    if (Buffer.byteLength(eventJson) > maxStructuredOutputBytes)
      throw Error("Output exceeds limit.");
  } catch {
    eventJson = "";
    reportingIssues.push({
      code: "notification-unavailable",
      message:
        "The notification event could not be prepared; the Action result is preserved.",
    });
    core.warning(
      "The notification event could not be prepared; the Action result is preserved.",
    );
  }
  const json = JSON.stringify(result);
  let outputFailure = false;
  for (const [name, value] of Object.entries({
    operation: result.operation,
    "deployment-code": result.deploymentCode ?? "",
    "original-deployment-code": result.originalDeploymentCode ?? "",
    "build-code": result.buildCode ?? "",
    "environment-code": result.environmentCode ?? "",
    "deployment-status": result.deploymentStatus ?? "",
    "deployment-percentage":
      result.percentage === undefined ? "" : String(result.percentage),
    "action-required": String(result.actionRequired),
    decision: result.decision ?? "",
    "poll-count": String(result.pollCount),
    "duration-ms": String(result.durationMs),
    "result-json": json,
    "notification-event": eventJson,
  })) {
    try {
      const limit =
        name === "result-json" || name === "notification-event"
          ? maxStructuredOutputBytes
          : 16384;
      if (Buffer.byteLength(value) > limit)
        throw Error("Output exceeds limit.");
      core.setOutput(name, value);
    } catch {
      outputFailure = true;
    }
  }
  if (outputFailure) {
    core.warning(
      "Action result outputs could not be written; the original result is preserved.",
    );
    reportingIssues.push({
      code: "outputs-unavailable",
      message:
        "Some Action outputs could not be written. Review the available result and run summary.",
    });
  }
  try {
    core.summary.addRaw(summary(result, safe, env, reportingIssues));
    await core.summary.write();
  } catch {
    core.warning("The step summary could not be written.");
  }
  return outputFailure;
}
