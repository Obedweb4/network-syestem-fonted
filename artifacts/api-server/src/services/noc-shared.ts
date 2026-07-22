import type { nocActionTypeEnum, nocRiskLevelEnum } from "@workspace/db/schema";

export type RouterStatus = "ONLINE" | "DEGRADED" | "OFFLINE";
export type NocActionType = (typeof nocActionTypeEnum.enumValues)[number];
export type NocRiskLevel = (typeof nocRiskLevelEnum.enumValues)[number];

/**
 * THE safety boundary for "AI recommends or executes safe actions."
 *
 * This map is the only thing that decides whether an action can ever run
 * without a human clicking Approve. It is keyed purely on `actionType` — a
 * closed, developer-defined enum — and is never read from, overridden by,
 * or derived from anything a language model outputs. noc-analysis.ts uses
 * this when it first classifies a recommendation; noc-actions.ts's executor
 * independently re-derives from this same map before ever auto-running
 * anything, so even a corrupted/hand-edited DB row can't grant an action
 * more trust than its type allows.
 *
 * To make a new action type auto-executable, a developer edits this file —
 * there is no runtime or LLM-controlled path that can promote an action's
 * risk level.
 */
export const ACTION_RISK_LEVEL: Record<NocActionType, NocRiskLevel> = {
  RESTART_MONITORING: "SAFE", // resets our own polling backoff — touches nothing on the router or a customer's account
  RETRY_PROVISIONING: "SAFE", // re-invokes the same idempotent, already-retried provisioning engine call, just sooner
  DISCONNECT_ORPHAN_SESSION: "SAFE", // drops a router session whose subscription is already EXPIRED/SUSPENDED/CANCELLED in billing — corrects drift, doesn't create it
  REACTIVATE_SUBSCRIPTION: "REQUIRES_APPROVAL",
  SUSPEND_SUBSCRIPTION: "REQUIRES_APPROVAL",
  REPROVISION_ROUTER: "REQUIRES_APPROVAL",
  NONE_INFO_ONLY: "INFO_ONLY",
};

export function riskLevelFor(actionType: NocActionType): NocRiskLevel {
  return ACTION_RISK_LEVEL[actionType] ?? "REQUIRES_APPROVAL"; // unknown type (shouldn't happen with a closed enum) never defaults to auto-executable
}
