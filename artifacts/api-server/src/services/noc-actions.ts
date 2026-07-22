import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { nocRecommendationsTable, nocIncidentEventsTable, routersTable } from "@workspace/db/schema";
import { listActivePppoeSessions, listActiveHotspotSessions, disconnectPppoeSession, disconnectHotspotSession } from "@workspace/mikrotik";
import { provisionSubscription, suspendSubscription, reactivateSubscription, reprovisionSubscription } from "./provisioning-engine";
import { restartMonitoring } from "./noc-collector";
import { getNocSettings } from "./noc-settings";
import { riskLevelFor } from "./noc-shared";
import { broadcast } from "./noc-sse";
import { logger } from "../lib/logger";

/**
 * AI NOC — Action executor
 * ──────────────────────────
 * Every branch below wraps a function that already existed before the NOC
 * did (provisioning-engine.ts's idempotent, audited, retried lifecycle
 * functions; the same session-disconnect helpers `sessions.ts` uses) — this
 * file adds no new way to mutate a router or a subscription, only a
 * recommendation-driven way to *call* the ones that already exist, gated by
 * `riskLevelFor()` from noc-shared.ts.
 *
 * The one genuinely new capability is RESTART_MONITORING, and even that
 * only resets this process's own in-memory polling state — it cannot reach
 * a router or a customer's account at all.
 *
 * `actor.userId` present = a human clicked Approve (POST /noc/recommendations/:id/approve).
 * `actor.userId` absent = the auto-remediation sweep is executing a SAFE
 * recommendation unattended. That distinction is what `riskLevelFor()` is
 * checked against below — a human can approve anything in the allowlist: a
 * suspend requested to run automatically without a human present is refused
 * outright, not "still asked but implicitly trusted."
 */

export interface ExecutionActor {
  userId?: string;
}

interface ExecutionResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

async function runAction(actionType: string, params: Record<string, unknown>, fallbackRouterId: string | null, fallbackSubscriptionId: string | null, actor: ExecutionActor): Promise<ExecutionResult> {
  const engineActor = actor.userId ? { userId: actor.userId } : undefined;

  switch (actionType) {
    case "RESTART_MONITORING": {
      const routerId = String(params.routerId ?? fallbackRouterId ?? "");
      if (!routerId) return { success: false, error: "Missing routerId" };
      restartMonitoring(routerId);
      return { success: true, data: { routerId } };
    }

    case "RETRY_PROVISIONING": {
      const subscriptionId = String(params.subscriptionId ?? fallbackSubscriptionId ?? "");
      if (!subscriptionId) return { success: false, error: "Missing subscriptionId" };
      const outcome = await provisionSubscription(subscriptionId, engineActor);
      return { success: outcome.success, error: outcome.error, data: { outcome: outcome as unknown as Record<string, unknown> } };
    }

    case "DISCONNECT_ORPHAN_SESSION": {
      const routerId = String(params.routerId ?? fallbackRouterId ?? "");
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      const sessionType = params.sessionType === "HOTSPOT" ? "HOTSPOT" : "PPPOE";
      if (!routerId || !sessionId) return { success: false, error: "Missing routerId/sessionId" };
      const [router] = await db.select().from(routersTable).where(eq(routersTable.id, routerId)).limit(1);
      if (!router) return { success: false, error: "Router not found" };
      const config = { id: router.id, tenantId: router.tenantId, name: router.name, ipAddress: router.ipAddress, apiPort: router.apiPort ?? 8728, apiUsername: router.apiUsername, apiSecret: router.apiSecret };
      const disconnected = sessionType === "HOTSPOT" ? await disconnectHotspotSession(config, sessionId) : await disconnectPppoeSession(config, sessionId);
      return { success: disconnected.success, error: disconnected.error };
    }

    case "REACTIVATE_SUBSCRIPTION": {
      const subscriptionId = String(params.subscriptionId ?? fallbackSubscriptionId ?? "");
      if (!subscriptionId) return { success: false, error: "Missing subscriptionId" };
      const outcome = await reactivateSubscription(subscriptionId, engineActor);
      return { success: outcome.success, error: outcome.error, data: { outcome: outcome as unknown as Record<string, unknown> } };
    }

    case "SUSPEND_SUBSCRIPTION": {
      const subscriptionId = String(params.subscriptionId ?? fallbackSubscriptionId ?? "");
      if (!subscriptionId) return { success: false, error: "Missing subscriptionId" };
      const reason = typeof params.reason === "string" && params.reason.trim() ? params.reason.trim() : "Suspended via AI NOC recommendation";
      const outcome = await suspendSubscription(subscriptionId, reason, "SUSPENDED", engineActor);
      return { success: outcome.success, error: outcome.error, data: { outcome: outcome as unknown as Record<string, unknown> } };
    }

    case "REPROVISION_ROUTER": {
      const subscriptionId = String(params.subscriptionId ?? fallbackSubscriptionId ?? "");
      const newRouterId = typeof params.newRouterId === "string" ? params.newRouterId : undefined;
      if (!subscriptionId || !newRouterId) return { success: false, error: "Missing subscriptionId/newRouterId" };
      const outcome = await reprovisionSubscription(subscriptionId, { newRouterId }, engineActor);
      return { success: outcome.success, error: outcome.error, data: { outcome: outcome as unknown as Record<string, unknown> } };
    }

    default:
      return { success: false, error: `"${actionType}" has no executable handler (informational-only recommendation).` };
  }
}

/** Finds sessions live on a router that have no corresponding ACTIVE/SUCCESS subscription — the read-only "candidate list" behind DISCONNECT_ORPHAN_SESSION recommendations. Exposed separately from execution so the analysis engine (or an admin's manual review) can see candidates before any recommendation is created. */
export async function findOrphanSessions(routerId: string): Promise<Array<{ sessionId: string; sessionType: "PPPOE" | "HOTSPOT"; identifier: string }>> {
  const [router] = await db.select().from(routersTable).where(eq(routersTable.id, routerId)).limit(1);
  if (!router) return [];
  const config = { id: router.id, tenantId: router.tenantId, name: router.name, ipAddress: router.ipAddress, apiPort: router.apiPort ?? 8728, apiUsername: router.apiUsername, apiSecret: router.apiSecret };
  const { provisioningMappingsTable, subscriptionsTable } = await import("@workspace/db/schema");

  const [pppoe, hotspot, activeMappings] = await Promise.all([
    listActivePppoeSessions(config),
    listActiveHotspotSessions(config),
    db.select({ routerUsername: provisioningMappingsTable.routerUsername, status: subscriptionsTable.status })
      .from(provisioningMappingsTable)
      .innerJoin(subscriptionsTable, eq(provisioningMappingsTable.subscriptionId, subscriptionsTable.id))
      .where(and(eq(provisioningMappingsTable.routerId, routerId), eq(provisioningMappingsTable.status, "SUCCESS"))),
  ]);
  const activeUsernames = new Set(activeMappings.filter((m) => m.status === "ACTIVE").map((m) => m.routerUsername));

  const orphans: Array<{ sessionId: string; sessionType: "PPPOE" | "HOTSPOT"; identifier: string }> = [];
  for (const s of pppoe) if (!activeUsernames.has(s.username)) orphans.push({ sessionId: s.id, sessionType: "PPPOE", identifier: s.username });
  for (const s of hotspot) if (s.username && !activeUsernames.has(s.username)) orphans.push({ sessionId: s.id, sessionType: "HOTSPOT", identifier: s.username });
  return orphans;
}

export async function executeRecommendation(recommendationId: string, tenantId: string, actor: ExecutionActor): Promise<ExecutionResult> {
  const [rec] = await db.select().from(nocRecommendationsTable).where(and(eq(nocRecommendationsTable.id, recommendationId), eq(nocRecommendationsTable.tenantId, tenantId))).limit(1);
  if (!rec) return { success: false, error: "Recommendation not found" };
  if (rec.status !== "PENDING") return { success: false, error: `Recommendation is already ${rec.status.toLowerCase()}` };

  // Re-derive risk from actionType independently of the stored `riskLevel`
  // column — defense in depth against a corrupted/hand-edited row.
  const risk = riskLevelFor(rec.actionType);
  const isHuman = Boolean(actor.userId);
  if (risk === "INFO_ONLY") return { success: false, error: "This recommendation is informational only; there is no action to execute." };
  if (!isHuman && risk !== "SAFE") return { success: false, error: "This action requires human approval and cannot run unattended." };

  const params = (rec.actionParams as Record<string, unknown> | null) ?? {};
  let result: ExecutionResult;
  try {
    result = await runAction(rec.actionType, params, rec.routerId, rec.subscriptionId, actor);
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  const newStatus = result.success ? (isHuman ? "EXECUTED" : "AUTO_EXECUTED") : "FAILED";
  await db.update(nocRecommendationsTable).set({
    status: newStatus, decidedByUserId: actor.userId, decidedAt: new Date(), executedAt: new Date(),
    executionResult: result.data ?? null, executionError: result.error ?? null,
  }).where(eq(nocRecommendationsTable.id, rec.id));

  if (rec.incidentId) {
    await db.insert(nocIncidentEventsTable).values({
      tenantId, incidentId: rec.incidentId, kind: "ACTION_EXECUTED",
      message: `${rec.title}: ${result.success ? "succeeded" : `failed — ${result.error}`}`,
      actorUserId: actor.userId, actorLabel: isHuman ? undefined : "AI NOC (auto)",
    }).catch((err) => logger.error({ err }, "Failed to record action-executed incident event"));
  }

  broadcast(tenantId, { type: "recommendation.updated", data: { recommendationId: rec.id, status: newStatus, success: result.success } });
  if (!result.success) logger.error({ recommendationId: rec.id, actionType: rec.actionType, error: result.error }, "NOC recommendation execution failed");
  return result;
}

export async function rejectRecommendation(recommendationId: string, tenantId: string, userId: string): Promise<{ success: boolean; error?: string }> {
  const [rec] = await db.select().from(nocRecommendationsTable).where(and(eq(nocRecommendationsTable.id, recommendationId), eq(nocRecommendationsTable.tenantId, tenantId))).limit(1);
  if (!rec) return { success: false, error: "Recommendation not found" };
  if (rec.status !== "PENDING") return { success: false, error: `Recommendation is already ${rec.status.toLowerCase()}` };
  await db.update(nocRecommendationsTable).set({ status: "REJECTED", decidedByUserId: userId, decidedAt: new Date() }).where(eq(nocRecommendationsTable.id, rec.id));
  if (rec.incidentId) {
    await db.insert(nocIncidentEventsTable).values({ tenantId, incidentId: rec.incidentId, kind: "NOTE", message: `Recommendation rejected: ${rec.title}`, actorUserId: userId }).catch(() => {});
  }
  broadcast(tenantId, { type: "recommendation.updated", data: { recommendationId: rec.id, status: "REJECTED" } });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Auto-remediation sweep — the only place SAFE recommendations run without
// a human. Independent of noc-analysis.ts's insert so that a recommendation
// still gets auto-executed even if any in-process call from analysis were
// ever skipped; this sweep is the single, always-on source of truth for
// "did every eligible SAFE recommendation get run."
// ---------------------------------------------------------------------------

const STALE_APPROVAL_DAYS = 7;

async function expireStaleRecommendations(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_APPROVAL_DAYS * 86_400_000);
  await db.update(nocRecommendationsTable).set({ status: "EXPIRED" })
    .where(and(eq(nocRecommendationsTable.status, "PENDING"), lt(nocRecommendationsTable.createdAt, cutoff)))
    .catch((err) => logger.error({ err }, "Failed to expire stale NOC recommendations"));
}

export async function runAutoRemediationSweep(): Promise<void> {
  const pending = await db.select().from(nocRecommendationsTable).where(eq(nocRecommendationsTable.status, "PENDING"));
  for (const rec of pending) {
    if (riskLevelFor(rec.actionType) !== "SAFE") continue;
    const settings = await getNocSettings(rec.tenantId);
    if (!settings.autoRemediationEnabled) continue;
    await executeRecommendation(rec.id, rec.tenantId, {}).catch((err) => logger.error({ err, recommendationId: rec.id }, "Auto-remediation execution threw"));
  }
  await expireStaleRecommendations();
}

export function startAutoRemediationSweep(intervalMs = 20_000): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAutoRemediationSweep();
    } catch (err) {
      logger.error({ err }, "Auto-remediation sweep failed");
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), intervalMs).unref();
}
