import type { Operation, Decision } from "./inputs.js";
export interface Result {
  schemaVersion: 1;
  operation: Operation;
  outcome:
    "success" | "failure" | "cancelled" | "action-required" | "internal-error";
  subscriptionCode?: string;
  originalDeploymentCode?: string;
  deploymentCode?: string;
  buildCode?: string;
  environmentCode?: string;
  databaseUpdateMode?: string;
  strategy?: string;
  deploymentStatus?: string;
  percentage?: number;
  pollCount: number;
  durationMs: number;
  actionRequired: boolean;
  decision?: Decision;
  newDeploymentCode?: string;
  timedOut: boolean;
  cancellation?: { requested: boolean; rollbackDatabase: boolean };
  trafficSplit?: { updated: boolean };
  error?: { code: string; message: string };
}
export const initialResult = (): Result => ({
  schemaVersion: 1,
  operation: "deploy",
  outcome: "internal-error",
  pollCount: 0,
  durationMs: 0,
  actionRequired: false,
  timedOut: false,
});
