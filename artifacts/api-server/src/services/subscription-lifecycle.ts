import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { subscriptionsTable, tenantsTable, loyaltyAccountsTable, loyaltyTransactionsTable, type Subscription } from "@workspace/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Grants a customer a plan's worth of access: extends their existing ACTIVE
 * subscription to that same plan if they have one (from the later of "now"
 * or its current expiry, so paying/redeeming early never wastes remaining
 * time), otherwise starts a new subscription. Also awards Loyalty Points for
 * the payment, if the tenant has configured a non-zero earn rate.
 *
 * This is the single source of truth for "what does redeeming a package
 * grant" — both STK-push payment activation
 * (`payment-activation.ts::activatePaymentFromCallback`) and self-serve
 * voucher redemption (`routes/portal.ts::POST /portal/vouchers/redeem`) call
 * this instead of each re-implementing renew-vs-create (or, previously,
 * each re-implementing point-earning — neither did, which is why no
 * customer could ever earn a point before this). Callers are responsible
 * for wrapping this in their own `db.transaction` alongside whatever else
 * must commit atomically with it (marking a payment COMPLETED, marking a
 * voucher USED, etc.) — this function does not open one itself.
 */
export async function renewOrCreateSubscription(
  tx: Tx,
  params: { tenantId: string; customerId: string; planId: string; durationDays: number; amountPaid: number },
): Promise<Subscription> {
  const { tenantId, customerId, planId, durationDays, amountPaid } = params;
  const now = new Date();
  const durationMs = durationDays * 24 * 60 * 60 * 1000;

  const [existingActive] = await tx.select().from(subscriptionsTable).where(and(
    eq(subscriptionsTable.tenantId, tenantId),
    eq(subscriptionsTable.customerId, customerId),
    eq(subscriptionsTable.planId, planId),
    eq(subscriptionsTable.status, "ACTIVE"),
  )).limit(1);

  let subscription: Subscription;
  if (existingActive) {
    const newExpiry = new Date(Math.max(existingActive.expiresAt.getTime(), now.getTime()) + durationMs);
    const [updated] = await tx.update(subscriptionsTable)
      .set({ expiresAt: newExpiry, expiryReminderSentAt: null, updatedAt: now })
      .where(eq(subscriptionsTable.id, existingActive.id))
      .returning();
    subscription = updated!;
  } else {
    const [inserted] = await tx.insert(subscriptionsTable).values({
      tenantId,
      customerId,
      planId,
      status: "ACTIVE",
      startsAt: now,
      expiresAt: new Date(now.getTime() + durationMs),
    }).returning();
    subscription = inserted!;
  }

  await awardLoyaltyPoints(tx, { tenantId, customerId, amountPaid, subscriptionId: subscription.id });
  return subscription;
}

/**
 * Awards Loyalty Points for a payment, if this tenant has set a non-zero earn
 * rate (Settings > Loyalty Points). A tenant that hasn't configured one earns
 * nothing — silently, not an error — matching the "opt-in, no surprise
 * behavior change" default on `tenants.loyaltyPointsPerKes`. Runs inside the
 * caller's transaction so a payment and its points either both commit or
 * neither does.
 */
async function awardLoyaltyPoints(tx: Tx, params: { tenantId: string; customerId: string; amountPaid: number; subscriptionId: string }): Promise<void> {
  if (!Number.isFinite(params.amountPaid) || params.amountPaid <= 0) return;

  const [tenant] = await tx.select({ rate: tenantsTable.loyaltyPointsPerKes }).from(tenantsTable).where(eq(tenantsTable.id, params.tenantId)).limit(1);
  const rate = Number(tenant?.rate ?? 0);
  if (!(rate > 0)) return;

  const points = Math.floor(params.amountPaid * rate);
  if (points <= 0) return;

  const [account] = await tx.select().from(loyaltyAccountsTable).where(eq(loyaltyAccountsTable.customerId, params.customerId)).limit(1);
  if (!account) return; // every customer gets one on creation (routes/customers.ts) — absence here means something upstream is broken, not something to paper over by creating one mid-payment

  const newBalance = account.balance + points;
  await tx.update(loyaltyAccountsTable).set({ balance: newBalance, lifetimeEarned: account.lifetimeEarned + points, updatedAt: new Date() }).where(eq(loyaltyAccountsTable.id, account.id));
  await tx.insert(loyaltyTransactionsTable).values({
    loyaltyAccountId: account.id, type: "EARNED", points, balanceAfter: newBalance,
    description: `Earned from subscription payment (${params.amountPaid} KES @ ${rate} pts/KES)`,
  });
}
