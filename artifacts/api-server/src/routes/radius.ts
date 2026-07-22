import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  radiusServerConfigTable,
  radiusAuthEventsTable,
  radiusAccountingTable,
  routersTable,
} from "@workspace/db/schema";
import { encryptCredential, decryptCredential } from "@workspace/crypto";
import { sendDisconnectRequest } from "@workspace/radius";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// Same role set as sessions.ts / noc.ts operator actions — RADIUS config and
// forced disconnects are a network-operations concern, not billing.
const RADIUS_OPERATOR_ROLES = ["SUPER_ADMIN", "BUSINESS_OWNER", "STAFF", "TECHNICIAN"] as const;
const RADIUS_CONFIG_ROLES = ["SUPER_ADMIN", "BUSINESS_OWNER"] as const;

// ---------------------------------------------------------------------------
// Tenant-wide server config (Admin > RADIUS)
// ---------------------------------------------------------------------------

router.get("/radius/config", requireAuth, async (req, res) => {
  const { tenantId } = req.user!;
  const [cfg] = await db.select().from(radiusServerConfigTable).where(eq(radiusServerConfigTable.tenantId, tenantId)).limit(1);
  if (!cfg) {
    res.json({
      tenantId, enabled: false, authPort: 1812, acctPort: 1813,
      defaultSessionTimeoutSec: null, defaultIdleTimeoutSec: null, defaultFramedPool: null,
      interimUpdateIntervalSec: 300, hasDefaultSecret: false,
    });
    return;
  }
  const { defaultSecretEncrypted, ...rest } = cfg;
  res.json({ ...rest, hasDefaultSecret: Boolean(defaultSecretEncrypted) });
});

const UpsertConfigBody = z.object({
  enabled: z.boolean().optional(),
  authPort: z.number().int().min(1).max(65535).optional(),
  acctPort: z.number().int().min(1).max(65535).optional(),
  defaultSecret: z.string().min(8).optional(), // plaintext in, only ever stored encrypted; never returned by GET
  defaultSessionTimeoutSec: z.number().int().positive().nullable().optional(),
  defaultIdleTimeoutSec: z.number().int().positive().nullable().optional(),
  defaultFramedPool: z.string().nullable().optional(),
  interimUpdateIntervalSec: z.number().int().positive().optional(),
});

/** Upserts this tenant's RADIUS config. A NAS's own `routers.radiusSecretEncrypted` always takes priority over `defaultSecret` here — see lib/radius/src/nas-resolver.ts. */
router.put("/radius/config", requireAuth, requireRole(...RADIUS_CONFIG_ROLES), async (req, res) => {
  const parse = UpsertConfigBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Validation failed", details: parse.error.issues }); return; }
  const { tenantId } = req.user!;
  const { defaultSecret, ...rest } = parse.data;

  const values = {
    ...rest,
    ...(defaultSecret ? { defaultSecretEncrypted: encryptCredential(defaultSecret) } : {}),
    updatedAt: new Date(),
  };

  const [existing] = await db.select({ id: radiusServerConfigTable.id }).from(radiusServerConfigTable).where(eq(radiusServerConfigTable.tenantId, tenantId)).limit(1);
  const [saved] = existing
    ? await db.update(radiusServerConfigTable).set(values).where(eq(radiusServerConfigTable.tenantId, tenantId)).returning()
    : await db.insert(radiusServerConfigTable).values({ tenantId, ...values }).returning();

  const { defaultSecretEncrypted, ...safe } = saved!;
  res.json({ ...safe, hasDefaultSecret: Boolean(defaultSecretEncrypted) });
});

// ---------------------------------------------------------------------------
// Auth audit trail
// ---------------------------------------------------------------------------

const ListAuthEventsQuery = z.object({
  result: z.enum(["ACCESS_ACCEPT", "ACCESS_REJECT"]).optional(),
  routerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get("/radius/auth-events", requireAuth, async (req, res) => {
  const parse = ListAuthEventsQuery.safeParse(req.query);
  if (!parse.success) { res.status(400).json({ error: "Invalid query" }); return; }
  const { tenantId } = req.user!;
  const conditions = [eq(radiusAuthEventsTable.tenantId, tenantId)];
  if (parse.data.result) conditions.push(eq(radiusAuthEventsTable.result, parse.data.result));
  if (parse.data.routerId) conditions.push(eq(radiusAuthEventsTable.routerId, parse.data.routerId));
  const data = await db.select().from(radiusAuthEventsTable).where(and(...conditions))
    .orderBy(desc(radiusAuthEventsTable.createdAt)).limit(parse.data.limit ?? 50);
  res.json(data);
});

// ---------------------------------------------------------------------------
// Accounting: online users + session history
// ---------------------------------------------------------------------------

router.get("/radius/sessions/online", requireAuth, async (req, res) => {
  const { tenantId } = req.user!;
  const data = await db.select().from(radiusAccountingTable)
    .where(and(eq(radiusAccountingTable.tenantId, tenantId), eq(radiusAccountingTable.status, "ACTIVE")))
    .orderBy(desc(radiusAccountingTable.startedAt));
  res.json(data);
});

const ListSessionsQuery = z.object({
  customerId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "STOPPED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get("/radius/sessions", requireAuth, async (req, res) => {
  const parse = ListSessionsQuery.safeParse(req.query);
  if (!parse.success) { res.status(400).json({ error: "Invalid query" }); return; }
  const { tenantId } = req.user!;
  const conditions = [eq(radiusAccountingTable.tenantId, tenantId)];
  if (parse.data.customerId) conditions.push(eq(radiusAccountingTable.customerId, parse.data.customerId));
  if (parse.data.status) conditions.push(eq(radiusAccountingTable.status, parse.data.status));
  const data = await db.select().from(radiusAccountingTable).where(and(...conditions))
    .orderBy(desc(radiusAccountingTable.startedAt)).limit(parse.data.limit ?? 50);
  res.json(data);
});

/** Tenant-wide summary for an Admin > RADIUS dashboard: online counts + last 24h auth outcomes. */
router.get("/radius/overview", requireAuth, async (req, res) => {
  const { tenantId } = req.user!;
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [onlineCount] = await db.select({ n: sql<number>`count(*)::int` }).from(radiusAccountingTable)
    .where(and(eq(radiusAccountingTable.tenantId, tenantId), eq(radiusAccountingTable.status, "ACTIVE")));
  const [acceptCount] = await db.select({ n: sql<number>`count(*)::int` }).from(radiusAuthEventsTable)
    .where(and(eq(radiusAuthEventsTable.tenantId, tenantId), eq(radiusAuthEventsTable.result, "ACCESS_ACCEPT"), gte(radiusAuthEventsTable.createdAt, since24h)));
  const [rejectCount] = await db.select({ n: sql<number>`count(*)::int` }).from(radiusAuthEventsTable)
    .where(and(eq(radiusAuthEventsTable.tenantId, tenantId), eq(radiusAuthEventsTable.result, "ACCESS_REJECT"), gte(radiusAuthEventsTable.createdAt, since24h)));
  const nasRouters = await db.select({ id: routersTable.id, name: routersTable.name, lastRadiusContactAt: routersTable.lastRadiusContactAt })
    .from(routersTable).where(and(eq(routersTable.tenantId, tenantId), eq(routersTable.radiusEnabled, true)));

  res.json({
    onlineSessions: onlineCount?.n ?? 0,
    last24h: { accepts: acceptCount?.n ?? 0, rejects: rejectCount?.n ?? 0 },
    nasRouters,
  });
});

// ---------------------------------------------------------------------------
// Admin-triggered disconnect (CoA Disconnect-Request)
// ---------------------------------------------------------------------------

const DisconnectBody = z.object({ sessionId: z.string().uuid() });

/**
 * Sends an RFC 5176 Disconnect-Request for one active RADIUS-accounted
 * session. Complements POST /sessions/:sessionId/disconnect (which talks
 * to RouterOS's API directly for non-RADIUS sessions) — this one is for
 * subscribers actually authenticated via PulseNet's own RADIUS server.
 */
router.post("/radius/sessions/disconnect", requireAuth, requireRole(...RADIUS_OPERATOR_ROLES), async (req, res) => {
  const parse = DisconnectBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "sessionId is required" }); return; }
  const { tenantId } = req.user!;

  const [session] = await db.select().from(radiusAccountingTable)
    .where(and(eq(radiusAccountingTable.id, parse.data.sessionId), eq(radiusAccountingTable.tenantId, tenantId))).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.status !== "ACTIVE") { res.status(409).json({ error: "Session is not active" }); return; }

  const [nasRouter] = await db.select().from(routersTable).where(eq(routersTable.id, session.routerId)).limit(1);
  if (!nasRouter) { res.status(404).json({ error: "NAS router not found" }); return; }

  const [cfg] = await db.select().from(radiusServerConfigTable).where(eq(radiusServerConfigTable.tenantId, tenantId)).limit(1);
  const secretEncrypted = nasRouter.radiusSecretEncrypted ?? cfg?.defaultSecretEncrypted;
  if (!secretEncrypted) { res.status(409).json({ error: "No RADIUS shared secret configured for this NAS" }); return; }

  const result = await sendDisconnectRequest({
    nasIpAddress: nasRouter.ipAddress,
    secret: decryptCredential(secretEncrypted),
    username: session.username,
  });

  res.status(result.acked ? 200 : 202).json(result);
});

export default router;
