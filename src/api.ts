import { ActionError, invalidResponse } from "./errors.js";
import {
  segment,
  type Inputs,
  type Decision,
  type TrafficSplitRequest,
} from "./inputs.js";
import { Http } from "./http.js";
import type { TokenManager } from "./auth.js";
export function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalidResponse();
  return v as Record<string, unknown>;
}
export function code(v: unknown): string {
  if (typeof v !== "string") throw invalidResponse();
  try {
    segment(v);
  } catch {
    throw invalidResponse();
  }
  return v;
}
export interface DeploymentDetail {
  code: string;
  buildCode?: string;
  environmentCode?: string;
  strategy?: string;
  databaseUpdateMode?: string;
  status?: string;
  expireAtTimestamp?: string;
  isCanaryAvailable?: boolean;
  canaryStatus?: string;
}
export interface DeploymentProgress {
  deploymentStatus: string;
  percentage?: number;
}
export class DeploymentApi {
  pollCount = 0;
  constructor(
    private input: Inputs,
    private http: Http,
    private tokens: TokenManager,
  ) {}
  path(id: string, tail = "") {
    return `deployments/${segment(id)}${tail ? "/" + tail : ""}`;
  }
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    expected = [200],
    label = "DEPLOYMENT_PROGRESS",
  ): Promise<unknown> {
    const url = new URL(
      `v2/subscriptions/${segment(this.input.subscriptionCode)}/${path}`,
      this.input.apiBaseUrl,
    );
    for (let attempt = 0; ; attempt++) {
      const token = await this.tokens.get(attempt === 1);
      const init: RequestInit = {
        method,
        headers: {
          Accept: "application/json",
          "x-approuter-authorization": `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      };
      const counted = new Http(
        {
          ...this.http.rt,
          fetch: ((...args: Parameters<typeof fetch>) => {
            if (path.endsWith("/progress")) this.pollCount++;
            return this.http.rt.fetch(...args);
          }) as typeof fetch,
        },
        this.http.signal,
      );
      let reply;
      try {
        reply = await (method === "GET"
          ? counted.safeRequest(url.href, init)
          : counted.once(url.href, init));
      } catch (error) {
        if (method !== "GET" && !this.http.signal.aborted)
          throw new ActionError(
            label + "_AMBIGUOUS",
            "The mutation may have succeeded. Inspect Cloud Portal before retrying.",
          );
        throw error;
      }
      if (reply.status === 401 && attempt === 0) continue;
      if (!expected.includes(reply.status)) {
        let errorCode = label + "_FAILED";
        if (method !== "GET" && (reply.status === 429 || reply.status >= 500))
          errorCode = label + "_AMBIGUOUS";
        if (
          path.endsWith("/cancellationoptions") &&
          [404, 501].includes(reply.status)
        )
          errorCode =
            reply.status === 404
              ? "DEPLOYMENT_CANCELLATION_UNAVAILABLE"
              : "DEPLOYMENT_CANCELLATION_DISABLED";
        // Never echo provider text: it can contain unknown infrastructure credentials.
        throw new ActionError(
          errorCode,
          `CCv2 request failed (HTTP ${reply.status}).`,
          reply.status,
        );
      }
      return reply.body;
    }
  }
  async modes() {
    const b = await this.request(
      "deploymentmodes",
      "GET",
      undefined,
      [200],
      "DEPLOYMENT_MODES",
    );
    const fail = () => {
      throw new ActionError(
        "DEPLOYMENT_MODE_NOT_ALLOWED",
        "The environment or requested deployment modes are unavailable.",
      );
    };
    if (!Array.isArray(b)) return fail();
    const row = b.find(
      (v) => v && v.environmentCode === this.input.environmentCode,
    );
    const modes = row?.deploymentModes;
    if (
      !modes ||
      !Array.isArray(modes.dataMigrationMode) ||
      !Array.isArray(modes.deploymentMode) ||
      !modes.dataMigrationMode.includes(this.input.databaseUpdateMode) ||
      !modes.deploymentMode.includes(this.input.strategy)
    )
      fail();
  }
  async create() {
    const { buildCode, environmentCode, databaseUpdateMode, strategy } =
      this.input;
    const b = await this.request(
      "deployments",
      "POST",
      { buildCode, environmentCode, databaseUpdateMode, strategy },
      [201],
      "CREATE_DEPLOYMENT",
    );
    try {
      const v = object(b);
      this.identity(v);
      return code(v.code);
    } catch {
      throw new ActionError(
        "CREATE_DEPLOYMENT_AMBIGUOUS",
        "Deployment creation may have succeeded but its response was invalid. Inspect Cloud Portal before retrying.",
      );
    }
  }
  private identity(b: Record<string, unknown>, id?: string) {
    if (
      (b.subscriptionCode !== undefined &&
        b.subscriptionCode !== this.input.subscriptionCode) ||
      (id !== undefined &&
        b.deploymentCode !== undefined &&
        b.deploymentCode !== id)
    )
      throw invalidResponse();
  }
  async detail(id: string): Promise<DeploymentDetail> {
    const b = object(await this.request(this.path(id)));
    this.identity(b, id);
    if (code(b.code) !== id) throw invalidResponse();
    const result: DeploymentDetail = { code: id };
    for (const k of ["buildCode", "environmentCode"] as const)
      if (b[k] !== undefined) result[k] = code(b[k]);
    for (const k of [
      "strategy",
      "databaseUpdateMode",
      "status",
      "expireAtTimestamp",
      "canaryStatus",
    ] as const)
      if (b[k] !== undefined) {
        if (typeof b[k] !== "string" || b[k].length > 128)
          throw invalidResponse();
        result[k] = b[k];
      }
    if (b.isCanaryAvailable !== undefined) {
      if (typeof b.isCanaryAvailable !== "boolean") throw invalidResponse();
      result.isCanaryAvailable = b.isCanaryAvailable;
    }
    return result;
  }
  async progress(id: string): Promise<DeploymentProgress> {
    const b = object(await this.request(this.path(id, "progress")));
    this.identity(b, id);
    if (
      typeof b.deploymentStatus !== "string" ||
      !b.deploymentStatus ||
      b.deploymentStatus.length > 128
    )
      throw invalidResponse();
    return {
      deploymentStatus: b.deploymentStatus,
      ...(typeof b.percentage === "number" &&
      Number.isInteger(b.percentage) &&
      b.percentage >= 0 &&
      b.percentage <= 100
        ? { percentage: b.percentage }
        : {}),
    };
  }
  async decisions(id: string) {
    const b = object(await this.request(this.path(id, "decisions")));
    if (!Array.isArray(b.deploymentDecisions)) throw invalidResponse();
    return b.deploymentDecisions.map((v) => {
      const x = object(v);
      if (!["ACCEPT", "PREPARE_CANARY", "REJECT"].includes(String(x.type)))
        throw invalidResponse();
      return x.type as Decision;
    });
  }
  async decide(id: string, decision: Decision) {
    const b = await this.request(
      this.path(id, "decisions"),
      "POST",
      {
        decision,
        ...(this.input.decisionReason
          ? { reason: this.input.decisionReason }
          : {}),
      },
      [200, 201],
      "DEPLOYMENT_DECISION",
    );
    try {
      const v = object(b);
      if ((v.decision ?? v.decison) !== decision) throw invalidResponse();
      return v.newDeploymentCode === undefined
        ? undefined
        : code(v.newDeploymentCode);
    } catch {
      throw new ActionError(
        "DEPLOYMENT_DECISION_AMBIGUOUS",
        "The decision response was invalid. Inspect Cloud Portal before retrying.",
      );
    }
  }
  async cancel(id: string) {
    const options = object(
      await this.request(
        this.path(id, "cancellationoptions"),
        "GET",
        undefined,
        [200],
        "DEPLOYMENT_CANCELLATION",
      ),
    );
    if (
      this.input.rollbackDatabase &&
      (typeof options.databaseRollbackRestoreTimestamp !== "string" ||
        !Number.isFinite(Date.parse(options.databaseRollbackRestoreTimestamp)))
    )
      throw new ActionError(
        "DEPLOYMENT_CANCELLATION_UNAVAILABLE",
        "Database rollback is unavailable.",
      );
    await this.request(
      this.path(id, "cancellation"),
      "POST",
      {
        rollbackDatabase: this.input.rollbackDatabase,
        ...(this.input.cancelReason
          ? { cancelReason: this.input.cancelReason }
          : {}),
      },
      [202],
      "DEPLOYMENT_CANCELLATION",
    );
  }
  async updateTraffic(id: string, split: TrafficSplitRequest) {
    const b = await this.request(
      this.path(id, "trafficsplit"),
      "PUT",
      split,
      [200, 201],
      "TRAFFIC_SPLIT_UPDATE",
    );
    try {
      const v = object(b);
      this.identity(v, id);
      for (const key of ["endpoints", "services"] as const) {
        if (split[key] && !Array.isArray(v[key])) throw invalidResponse();
        if (v[key] !== undefined) {
          if (!Array.isArray(v[key])) throw invalidResponse();
          for (const entry of v[key]) {
            const e = object(entry);
            code(e.code);
            if (
              !Number.isInteger(e.percentage) ||
              Number(e.percentage) < 0 ||
              Number(e.percentage) > 100
            )
              throw invalidResponse();
          }
        }
      }
    } catch {
      throw new ActionError(
        "TRAFFIC_SPLIT_UPDATE_AMBIGUOUS",
        "The traffic split response was invalid. Inspect Cloud Portal before retrying.",
      );
    }
  }
}
export function decisionPoint(
  detail: DeploymentDetail,
  progress: DeploymentProgress,
  history: Decision[],
  now = Date.now(),
): boolean {
  return (
    progress.deploymentStatus === "DEPLOYING" &&
    detail.status === "DEPLOYING" &&
    Number.isFinite(Date.parse(detail.expireAtTimestamp ?? "")) &&
    Date.parse(detail.expireAtTimestamp!) > now &&
    detail.isCanaryAvailable === true &&
    ["STARTED", "SUCCEEDED"].includes(detail.canaryStatus ?? "") &&
    !history.some((d) => d === "ACCEPT" || d === "REJECT")
  );
}
