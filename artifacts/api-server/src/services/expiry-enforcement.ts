import { and, eq, lt, gt, lte, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { subscriptionsTable, customersTable, servicePlansTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { suspendSubscription } from "./provisioning-engine";
import { queueCustomerNotification } from "../lib/notify";

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000; // remind once a subscription is within 24h of expiring

/**
 * Enforces billing expiry on the router via the shared provisioning engine
 * (services/provisioning-engine.ts) instead of talking to MikroTik directly
 * — this is what makes an expiry, a staff suspension, and an overdue
 * invoice all disable network access through the exact same code path,
 * with the exact same audit trail (provisioning_audit_logs,
 * subscription_status_history).
 */
export async function enforceExpiredSubscriptions(): Promise<void> {
  const now = new Date();
  const expired = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.status, "ACTIVE"), lt(subscriptionsTable.expiresAt, now)));

  for (const { id } of expired) {
    try {
      const result = await suspendSubscription(id, "Subscription expired", "EXPIRED");
      if (!result.success) logger.error({ subscriptionId: id, error: result.error }, "Expiry enforcement failed; it will retry on the next sweep");
    } catch (err) {
      logger.error({ err, subscriptionId: id }, "Expiry enforcement threw unexpectedly; it will retry on the next sweep");
    }
  }
}

/** Starts a non-overlapping one-minute expiry sweep for this API process. */
export function startExpiryEnforcement(intervalMs = 60_000): void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await enforceExpiredSubscriptions();
    } finally {
      running = false;
    }
  };
  void sweep();
  setInterval(() => void sweep(), intervalMs).unref();
}

/**
 * Sends the "expiry_reminder" SMS once per billing period, for any ACTIVE
 * subscription entering its final REMINDER_WINDOW_MS. Guarded by
 * expiryReminderSentAt so a subscription is never reminded twice for the
 * same expiresAt — that flag is reset to null on renewal/refill (see
 * services/subscription-lifecycle.ts and routes/customers.ts), so the next
 * billing cycle gets its own reminder.
 */
export async function sendExpiryReminders(): Promise<void> {
  const now = new Date();
  const dueSoon = await db.select({
    subscriptionId: subscriptionsTable.id,
    expiresAt: subscriptionsTable.expiresAt,
    customer: customersTable,
    planName: servicePlansTable.name,
  })
    .from(subscriptionsTable)
    .innerJoin(customersTable, eq(customersTable.id, subscriptionsTable.customerId))
    .innerJoin(servicePlansTable, eq(servicePlansTable.id, subscriptionsTable.planId))
    .where(and(
      eq(subscriptionsTable.status, "ACTIVE"),
      isNull(subscriptionsTable.expiryReminderSentAt),
      gt(subscriptionsTable.expiresAt, now),
      lte(subscriptionsTable.expiresAt, new Date(now.getTime() + REMINDER_WINDOW_MS)),
    ));

  for (const row of dueSoon) {
    try {
      await queueCustomerNotification(row.customer, "expiry_reminder", {
        planName: row.planName,
        expiryDate: row.expiresAt.toISOString().slice(0, 16).replace("T", " "),
      });
      await db.update(subscriptionsTable).set({ expiryReminderSentAt: now }).where(eq(subscriptionsTable.id, row.subscriptionId));
    } catch (err) {
      logger.error({ err, subscriptionId: row.subscriptionId }, "Expiry reminder failed; it will retry on the next sweep");
    }
  }
}

/** Starts a non-overlapping sweep for expiry reminders, separate from the enforcement sweep above since they run on different (and independently tunable) intervals. */
export function startExpiryReminderSweep(intervalMs = 15 * 60_000): void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await sendExpiryReminders();
    } finally {
      running = false;
    }
  };
  void sweep();
  setInterval(() => void sweep(), intervalMs).unref();
}
