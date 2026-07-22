import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  routersTable, subscriptionsTable, customersTable,
  walletsTable, loyaltyAccountsTable, usersTable, ROLES,
} from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

/**
 * Read-only operational snapshot for Settings > System. Deliberately just
 * reports what's true right now rather than exposing any control here —
 * there is no real "system configuration" concept in this app yet (env
 * vars/deployment config, not DB rows), so this is honest about being
 * informational only.
 */
router.get("/settings/system", requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.BUSINESS_OWNER), async (req, res) => {
  const { tenantId } = req.user!;
  const [routerCount] = await db.select({ n: sql<string>`count(*)` }).from(routersTable).where(eq(routersTable.tenantId, tenantId));
  const [activeSubs] = await db.select({ n: sql<string>`count(*)` }).from(subscriptionsTable).where(and(eq(subscriptionsTable.tenantId, tenantId), eq(subscriptionsTable.status, "ACTIVE")));
  const [staffCount] = await db.select({ n: sql<string>`count(*)` }).from(usersTable).where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.status, "ACTIVE")));

  res.json({
    environment: process.env.NODE_ENV ?? "development",
    smsConfigured: !!(process.env.TEXIN_API_URL || process.env.SMS_PROVIDER),
    mpesaEnvVarsConfigured: !!(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_SHORTCODE),
    llmNarrativeConfigured: !!process.env.ANTHROPIC_API_KEY,
    counts: { routers: Number(routerCount?.n ?? 0), activeSubscriptions: Number(activeSubs?.n ?? 0), activeStaff: Number(staffCount?.n ?? 0) },
    serverTime: new Date().toISOString(),
  });
});

/**
 * Tenant-wide Loyalty points + wallet aggregates for Settings > Loyalty Points /
 * Wallet. Both tables lack their own tenantId column, so scoping goes
 * through customers (same pattern as the cross-tenant fix already applied
 * in routes/customers.ts's /wallet and /loyalty endpoints).
 */
router.get("/settings/loyalty-overview", requireAuth, requireRole(ROLES.SUPER_ADMIN, ROLES.BUSINESS_OWNER), async (req, res) => {
  const { tenantId } = req.user!;

  const [loyalty] = await db.select({
    accounts: sql<string>`count(*)`,
    outstandingPoints: sql<string>`coalesce(sum(${loyaltyAccountsTable.balance}), 0)`,
    lifetimeEarned: sql<string>`coalesce(sum(${loyaltyAccountsTable.lifetimeEarned}), 0)`,
  }).from(loyaltyAccountsTable).innerJoin(customersTable, eq(customersTable.id, loyaltyAccountsTable.customerId)).where(eq(customersTable.tenantId, tenantId));

  const [wallet] = await db.select({
    accounts: sql<string>`count(*)`,
    outstandingBalance: sql<string>`coalesce(sum(${walletsTable.balance}), 0)`,
  }).from(walletsTable).innerJoin(customersTable, eq(customersTable.id, walletsTable.customerId)).where(eq(customersTable.tenantId, tenantId));

  res.json({
    loyalty: { accountsWithBalance: Number(loyalty?.accounts ?? 0), outstandingPoints: Number(loyalty?.outstandingPoints ?? 0), lifetimeEarned: Number(loyalty?.lifetimeEarned ?? 0) },
    wallet: { accounts: Number(wallet?.accounts ?? 0), outstandingBalanceKes: Number(wallet?.outstandingBalance ?? 0) },
  });
});

export default router;
