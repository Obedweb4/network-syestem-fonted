import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { routersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { listActivePppoeSessions, listActiveHotspotSessions, disconnectPppoeSession, disconnectHotspotSession } from "@workspace/mikrotik";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

/** Live (currently-connected) PPPoE + Hotspot sessions on one router, queried directly from RouterOS — not from any DB table, so it always reflects what's actually connected right now. */
router.get("/routers/:routerId/sessions", requireAuth, async (req, res) => {
  const { tenantId } = req.user!;
  const [router_] = await db.select().from(routersTable).where(and(eq(routersTable.id, req.params.routerId), eq(routersTable.tenantId, tenantId))).limit(1);
  if (!router_) { res.status(404).json({ error: "Router not found" }); return; }

  const config = { id: router_.id, tenantId: router_.tenantId, name: router_.name, ipAddress: router_.ipAddress, apiPort: router_.apiPort ?? 8728, apiUsername: router_.apiUsername, apiSecret: router_.apiSecret };
  const [pppoe, hotspot] = await Promise.all([listActivePppoeSessions(config), listActiveHotspotSessions(config)]);
  res.json({ routerId: router_.id, pppoe, hotspot });
});

const DisconnectBody = z.object({ routerId: z.string().uuid(), type: z.enum(["PPPOE", "HOTSPOT"]) });

/** Force-disconnects one live session. Does not disable the underlying account — the customer can reconnect immediately unless separately suspended (see POST /subscriptions/:id/suspend). */
router.post("/sessions/:sessionId/disconnect", requireAuth, requireRole("SUPER_ADMIN", "BUSINESS_OWNER", "STAFF", "TECHNICIAN"), async (req, res) => {
  const bodyParse = DisconnectBody.safeParse(req.body);
  if (!bodyParse.success) { res.status(400).json({ error: "routerId and type are required" }); return; }
  const { tenantId } = req.user!;
  const [router_] = await db.select().from(routersTable).where(and(eq(routersTable.id, bodyParse.data.routerId), eq(routersTable.tenantId, tenantId))).limit(1);
  if (!router_) { res.status(404).json({ error: "Router not found" }); return; }

  const config = { id: router_.id, tenantId: router_.tenantId, name: router_.name, ipAddress: router_.ipAddress, apiPort: router_.apiPort ?? 8728, apiUsername: router_.apiUsername, apiSecret: router_.apiSecret };
  const result = bodyParse.data.type === "HOTSPOT"
    ? await disconnectHotspotSession(config, req.params.sessionId)
    : await disconnectPppoeSession(config, req.params.sessionId);

  res.status(result.success ? 200 : 502).json(result);
});

export default router;
