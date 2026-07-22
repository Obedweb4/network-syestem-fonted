import { and, eq, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { routersTable, routerHealthSnapshotsTable, nocSettingsTable, type Router } from "@workspace/db/schema";
import { collectRouterMetrics, type RouterMetricsResult } from "@workspace/mikrotik";
import { logger } from "../lib/logger";
import { broadcast } from "./noc-sse";
import { handleRouterTransition, type RouterStatus } from "./noc-analysis";

/**
 * AI NOC — Collector
 * ───────────────────
 * A single global timer (not one per router/tenant — see the "due" check
 * below) that, on each tick, polls every router whose per-tenant interval
 * has elapsed, with bounded concurrency so a fleet of routers can't open
 * hundreds of simultaneous RouterOS API connections at once. Persists one
 * `router_health_snapshots` row per successful-or-failed poll and hands any
 * ONLINE/OFFLINE/DEGRADED *transition* to noc-analysis.ts, which owns all
 * fault-detection/correlation/incident logic — this file's only job is
 * "go get the numbers, reliably, without falling over."
 */

const DEGRADED_CPU_PERCENT = 90;
const DEGRADED_MEMORY_PERCENT = 90;
const MAX_CONCURRENT_POLLS = 6;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000; // never wait more than 30 min between attempts on a dead router
// A gap this long since the previous sample means "don't trust a rate from
// this pair" (router was down, process restarted, tenant paused polling,
// etc.) rather than a genuine multi-minute traffic reading.
const MAX_TRUSTED_GAP_MS = 10 * 60_000;

interface RouterRuntimeState {
  lastPolledAt: number;
  consecutiveFailures: number;
  skipUntil: number;
  lastStatus: RouterStatus | null;
  lastSample: { rxBytes: number; txBytes: number; at: number } | null;
}

const runtimeState = new Map<string, RouterRuntimeState>();

function stateFor(routerId: string): RouterRuntimeState {
  let s = runtimeState.get(routerId);
  if (!s) {
    s = { lastPolledAt: 0, consecutiveFailures: 0, skipUntil: 0, lastStatus: null, lastSample: null };
    runtimeState.set(routerId, s);
  }
  return s;
}

/** Clears a router's backoff/failure state and forces it to be due on the next tick — the handler behind the AI NOC's RESTART_MONITORING action. */
export function restartMonitoring(routerId: string): void {
  runtimeState.set(routerId, { lastPolledAt: 0, consecutiveFailures: 0, skipUntil: 0, lastStatus: runtimeState.get(routerId)?.lastStatus ?? null, lastSample: null });
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function classifyStatus(metrics: RouterMetricsResult): RouterStatus {
  if (!metrics.reachable) return "OFFLINE";
  if ((metrics.cpuLoadPercent ?? 0) >= DEGRADED_CPU_PERCENT || (metrics.memoryUsedPercent ?? 0) >= DEGRADED_MEMORY_PERCENT) return "DEGRADED";
  return "ONLINE";
}

async function pollOneRouter(router: Router, tenantPollIntervalMs: number): Promise<void> {
  const state = stateFor(router.id);
  const now = Date.now();
  if (now < state.skipUntil) return;
  if (now - state.lastPolledAt < tenantPollIntervalMs) return;
  state.lastPolledAt = now;

  const config = { id: router.id, tenantId: router.tenantId, name: router.name, ipAddress: router.ipAddress, apiPort: router.apiPort ?? 8728, apiUsername: router.apiUsername, apiSecret: router.apiSecret };
  const metrics = await collectRouterMetrics(config, router.wanInterface ?? undefined);
  const status = classifyStatus(metrics);

  let rxBps: number | null = null;
  let txBps: number | null = null;
  if (metrics.reachable && state.lastSample && now - state.lastSample.at <= MAX_TRUSTED_GAP_MS) {
    const seconds = Math.max((now - state.lastSample.at) / 1000, 1);
    rxBps = Math.max(0, Math.round((metrics.rxBytes - state.lastSample.rxBytes) / seconds));
    txBps = Math.max(0, Math.round((metrics.txBytes - state.lastSample.txBytes) / seconds));
  }
  if (metrics.reachable) state.lastSample = { rxBytes: metrics.rxBytes, txBytes: metrics.txBytes, at: now };

  if (metrics.reachable) {
    state.consecutiveFailures = 0;
    state.skipUntil = 0;
  } else {
    state.consecutiveFailures += 1;
    state.skipUntil = now + Math.min(BACKOFF_BASE_MS * 2 ** (state.consecutiveFailures - 1), BACKOFF_MAX_MS);
  }

  try {
    await db.insert(routerHealthSnapshotsTable).values({
      tenantId: router.tenantId, routerId: router.id, status,
      cpuLoadPercent: metrics.cpuLoadPercent, memoryUsedPercent: metrics.memoryUsedPercent, uptimeSeconds: metrics.uptimeSeconds,
      pppoeActiveCount: metrics.pppoeActiveCount, hotspotActiveCount: metrics.hotspotActiveCount,
      rxBps: rxBps != null ? String(rxBps) : null, txBps: txBps != null ? String(txBps) : null,
      errorMessage: metrics.error ?? null,
    });
  } catch (err) {
    logger.error({ err, routerId: router.id }, "Failed to persist router health snapshot");
  }

  broadcast(router.tenantId, {
    type: "router.snapshot",
    data: { routerId: router.id, routerName: router.name, status, cpuLoadPercent: metrics.cpuLoadPercent, memoryUsedPercent: metrics.memoryUsedPercent, pppoeActiveCount: metrics.pppoeActiveCount, hotspotActiveCount: metrics.hotspotActiveCount, rxBps, txBps },
  });

  const previousStatus = state.lastStatus;
  state.lastStatus = status;
  if (previousStatus !== null && previousStatus !== status) {
    handleRouterTransition(router, previousStatus, status, metrics).catch((err) =>
      logger.error({ err, routerId: router.id }, "NOC analysis threw while handling a router status transition"),
    );
  }
}

async function collectorTick(): Promise<void> {
  const routers = await db.select().from(routersTable).where(eq(routersTable.isActive, true));
  if (routers.length === 0) return;

  const tenantIds = [...new Set(routers.map((r) => r.tenantId))];
  const settingsRows = tenantIds.length ? await db.select().from(nocSettingsTable) : [];
  const settingsByTenant = new Map(settingsRows.map((s) => [s.tenantId, s]));
  const defaultIntervalMs = 60_000;

  await runWithConcurrency(routers, MAX_CONCURRENT_POLLS, (router) =>
    pollOneRouter(router, (settingsByTenant.get(router.tenantId)?.pollIntervalSeconds ?? defaultIntervalMs / 1000) * 1000).catch((err) =>
      logger.error({ err, routerId: router.id }, "Unhandled error polling router for NOC"),
    ),
  );
}

async function pruneOldSnapshots(): Promise<void> {
  const tenants = await db.select().from(nocSettingsTable);
  // Tenants without a noc_settings row yet (default not created) fall back
  // to the schema default (90 days) via a fixed cutoff, applied directly.
  const defaultCutoff = new Date(Date.now() - 90 * 86_400_000);
  await db.delete(routerHealthSnapshotsTable).where(lt(routerHealthSnapshotsTable.capturedAt, defaultCutoff)).catch((err) =>
    logger.error({ err }, "Default snapshot retention prune failed"),
  );
  for (const t of tenants) {
    if (t.snapshotRetentionDays === 90) continue; // already covered by the default cutoff above
    const cutoff = new Date(Date.now() - t.snapshotRetentionDays * 86_400_000);
    await db.delete(routerHealthSnapshotsTable).where(and(eq(routerHealthSnapshotsTable.tenantId, t.tenantId), lt(routerHealthSnapshotsTable.capturedAt, cutoff))).catch((err) =>
      logger.error({ err, tenantId: t.tenantId }, "Per-tenant snapshot retention prune failed"),
    );
  }
}

export function startNocCollector(tickMs = 30_000): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await collectorTick();
    } catch (err) {
      logger.error({ err }, "NOC collector tick failed");
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), tickMs).unref();

  let pruning = false;
  const prune = async () => {
    if (pruning) return;
    pruning = true;
    try {
      await pruneOldSnapshots();
    } catch (err) {
      logger.error({ err }, "NOC snapshot retention sweep failed");
    } finally {
      pruning = false;
    }
  };
  setInterval(() => void prune(), 6 * 60 * 60_000).unref(); // every 6h
}
