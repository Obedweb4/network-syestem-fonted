import { Router, type IRouter } from "express";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  customersTable, invoicesTable, routerAlertsTable, routersTable,
  subscriptionsTable, vouchersTable,
} from "@workspace/db/schema";
import { countActiveHotspotUsers, countActivePppoeUsers, MikroTikClient, type RouterConfig } from "@workspace/mikrotik";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const trafficState = new Map<string, { rx: number; tx: number; at: number }>();

function asRouters(rows: typeof routersTable.$inferSelect[]): RouterConfig[] {
  return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, name: r.name, ipAddress: r.ipAddress, apiPort: r.apiPort ?? 8728, apiUsername: r.apiUsername, apiSecret: r.apiSecret }));
}
function list(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? data as Array<Record<string, unknown>> : data ? [data as Record<string, unknown>] : [];
}
function number(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? n : 0; }

async function liveNetwork(routers: RouterConfig[]) {
  const snapshots = await Promise.all(routers.map(async (routerConfig) => {
    const client = new MikroTikClient(routerConfig);
    try {
      const connected = await client.connect();
      if (!connected.success) return { id: routerConfig.id, name: routerConfig.name, reachable: false, cpu: 0, memoryPercent: 0, pppoe: 0, hotspot: 0, trafficInBps: 0, trafficOutBps: 0 };
      const [resource, ppp, hotspot, interfaces] = await Promise.all([
        client.run("/system/resource", "print", {}), client.run("/ppp/active", "print", {}),
        client.run("/ip/hotspot/active", "print", {}), client.run("/interface", "print", {}),
      ]);
      const stats = list(resource.data)[0] ?? {};
      const rx = list(interfaces.data).reduce((sum, item) => sum + number(item["rx-byte"]), 0);
      const tx = list(interfaces.data).reduce((sum, item) => sum + number(item["tx-byte"]), 0);
      const now = Date.now(); const previous = trafficState.get(routerConfig.id);
      trafficState.set(routerConfig.id, { rx, tx, at: now });
      const seconds = previous ? Math.max((now - previous.at) / 1000, 1) : 1;
      return {
        id: routerConfig.id, name: routerConfig.name, reachable: true,
        cpu: number(stats["cpu-load"]),
        memoryPercent: stats["total-memory"] ? Math.round((1 - number(stats["free-memory"]) / number(stats["total-memory"])) * 100) : 0,
        pppoe: list(ppp.data).length, hotspot: list(hotspot.data).length,
        trafficInBps: previous ? Math.max(0, (rx - previous.rx) / seconds) : 0,
        trafficOutBps: previous ? Math.max(0, (tx - previous.tx) / seconds) : 0,
      };
    } catch {
      return { id: routerConfig.id, name: routerConfig.name, reachable: false, cpu: 0, memoryPercent: 0, pppoe: 0, hotspot: 0, trafficInBps: 0, trafficOutBps: 0 };
    } finally { await client.disconnect(); }
  }));
  return snapshots;
}

router.get("/dashboard/summary", requireAuth, async (req, res) => {
  const tenantId = req.user!.tenantId;
  const [customers, activeSubscriptions, pendingInvoices, unusedVouchers, routers] = await Promise.all([
    db.select({ value: count() }).from(customersTable).where(eq(customersTable.tenantId, tenantId)),
    db.select({ value: count() }).from(subscriptionsTable).where(and(eq(subscriptionsTable.tenantId, tenantId), eq(subscriptionsTable.status, "ACTIVE"))),
    db.select({ value: count() }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "PENDING"))),
    db.select({ value: count() }).from(vouchersTable).where(and(eq(vouchersTable.tenantId, tenantId), eq(vouchersTable.status, "UNUSED"))),
    db.select().from(routersTable).where(and(eq(routersTable.tenantId, tenantId), eq(routersTable.isActive, true))),
  ]);
  const routerConfigs = asRouters(routers);
  const [activePppoeUsers, activeHotspotSessions] = await Promise.all([countActivePppoeUsers(routerConfigs), countActiveHotspotUsers(routerConfigs)]);
  const today = new Date(); today.setHours(0, 0, 0, 0); const month = new Date(today.getFullYear(), today.getMonth(), 1);
  const [todayRevenue, monthRevenue, expiring] = await Promise.all([
    db.select({ value: sql<string>`coalesce(sum(${invoicesTable.totalAmount}), 0)` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "PAID"), gte(invoicesTable.paidAt, today))),
    db.select({ value: sql<string>`coalesce(sum(${invoicesTable.totalAmount}), 0)` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "PAID"), gte(invoicesTable.paidAt, month))),
    db.select({ value: count() }).from(subscriptionsTable).where(and(eq(subscriptionsTable.tenantId, tenantId), eq(subscriptionsTable.status, "ACTIVE"), gte(subscriptionsTable.expiresAt, new Date()), lt(subscriptionsTable.expiresAt, new Date(Date.now() + 7 * 86400000)))),
  ]);
  res.json({ totalCustomers: customers[0]?.value ?? 0, activeSubscriptions: activeSubscriptions[0]?.value ?? 0, pendingInvoices: pendingInvoices[0]?.value ?? 0, unusedVouchers: unusedVouchers[0]?.value ?? 0, activePppoeUsers, activeHotspotSessions, pppoeClients: activePppoeUsers, hotspotClients: activeHotspotSessions, todayRevenue: todayRevenue[0]?.value ?? "0", monthRevenue: monthRevenue[0]?.value ?? "0", expiringSubscriptions: expiring[0]?.value ?? 0 });
});

router.get("/dashboard/subscription-stats", requireAuth, async (req, res) => {
  const rows = await db.select({ status: subscriptionsTable.status, value: count() }).from(subscriptionsTable).where(eq(subscriptionsTable.tenantId, req.user!.tenantId)).groupBy(subscriptionsTable.status);
  const stats = { active: 0, suspended: 0, expired: 0, cancelled: 0 };
  for (const row of rows) stats[row.status.toLowerCase() as keyof typeof stats] = Number(row.value);
  res.json(stats);
});

router.get("/dashboard/revenue-chart", requireAuth, async (req, res) => {
  const rows = await db.select({ date: sql<string>`to_char(${invoicesTable.paidAt}, 'YYYY-MM-DD')`, revenue: sql<string>`coalesce(sum(${invoicesTable.totalAmount}), 0)` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, req.user!.tenantId), eq(invoicesTable.status, "PAID"), gte(invoicesTable.paidAt, new Date(Date.now() - 30 * 86400000)))).groupBy(sql`to_char(${invoicesTable.paidAt}, 'YYYY-MM-DD')`).orderBy(sql`to_char(${invoicesTable.paidAt}, 'YYYY-MM-DD')`);
  res.json(rows.map((row) => ({ date: row.date, revenue: Number(row.revenue) })));
});

router.get("/dashboard/recent-activity", requireAuth, async (req, res) => {
  const rows = await db.select().from(invoicesTable).where(eq(invoicesTable.tenantId, req.user!.tenantId)).orderBy(sql`${invoicesTable.updatedAt} desc`).limit(12);
  res.json(rows.map((invoice) => ({ id: invoice.id, type: "invoice", description: `Invoice ${invoice.status.toLowerCase()} — KES ${invoice.totalAmount}`, createdAt: invoice.updatedAt })));
});

router.get("/dashboard/network-live", requireAuth, async (req, res) => {
  const routers = await db.select().from(routersTable).where(and(eq(routersTable.tenantId, req.user!.tenantId), eq(routersTable.isActive, true)));
  const data = await liveNetwork(asRouters(routers));
  res.json({ sampledAt: new Date(), routers: data, totals: data.reduce((a, r) => ({ trafficInBps: a.trafficInBps + r.trafficInBps, trafficOutBps: a.trafficOutBps + r.trafficOutBps, online: a.online + (r.reachable ? 1 : 0) }), { trafficInBps: 0, trafficOutBps: 0, online: 0 }) });
});

router.get("/dashboard/ai-analysis", requireAuth, async (req, res) => {
  const tenantId = req.user!.tenantId;
  const routers = await db.select().from(routersTable).where(and(eq(routersTable.tenantId, tenantId), eq(routersTable.isActive, true)));
  const [network, expiring, overdue, savedAlerts] = await Promise.all([
    liveNetwork(asRouters(routers)),
    db.select({ value: count() }).from(subscriptionsTable).where(and(eq(subscriptionsTable.tenantId, tenantId), eq(subscriptionsTable.status, "ACTIVE"), gte(subscriptionsTable.expiresAt, new Date()), lt(subscriptionsTable.expiresAt, new Date(Date.now() + 7 * 86400000)))),
    db.select({ value: count() }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "PENDING"), lt(invoicesTable.dueAt, new Date()))),
    db.select().from(routerAlertsTable).innerJoin(routersTable, eq(routersTable.id, routerAlertsTable.routerId)).where(and(eq(routersTable.tenantId, tenantId), eq(routerAlertsTable.isResolved, false))).limit(10),
  ]);
  const alerts: Array<{ severity: "critical" | "warning" | "info"; message: string }> = [];
  for (const router of network) { if (!router.reachable) alerts.push({ severity: "critical", message: `${router.name} is unreachable via RouterOS API.` }); else if (router.cpu >= 85) alerts.push({ severity: "warning", message: `${router.name} CPU is high (${router.cpu}%).` }); else if (router.memoryPercent >= 85) alerts.push({ severity: "warning", message: `${router.name} memory use is high (${router.memoryPercent}%).` }); }
  if (Number(expiring[0]?.value ?? 0) > 0) alerts.push({ severity: "warning", message: `${expiring[0]?.value} subscriptions expire within 7 days.` });
  if (Number(overdue[0]?.value ?? 0) > 0) alerts.push({ severity: "warning", message: `${overdue[0]?.value} invoices are overdue.` });
  for (const row of savedAlerts) alerts.push({ severity: row.router_alerts.severity === "CRITICAL" ? "critical" : row.router_alerts.severity === "WARN" ? "warning" : "info", message: row.router_alerts.message });
  const critical = alerts.filter((a) => a.severity === "critical").length; const warning = alerts.filter((a) => a.severity === "warning").length;
  const healthScore = Math.max(0, 100 - critical * 30 - warning * 8);
  res.json({ healthScore, summary: critical ? "Immediate attention is required on the network." : warning ? "Network is operating, with billing or capacity items that need attention." : "Network, billing and expiry indicators are within normal limits.", alerts, recommendedActions: [ ...(critical ? ["Check router reachability, power and WAN connectivity before making billing changes."] : []), ...(Number(expiring[0]?.value ?? 0) ? ["Send renewal reminders to customers whose service expires this week."] : []), ...(Number(overdue[0]?.value ?? 0) ? ["Follow up overdue invoices before their services are suspended."] : []), ...(warning && !critical ? ["Review the live traffic chart and router load before peak hours."] : []) ], analyzedAt: new Date() });
});

export default router;
