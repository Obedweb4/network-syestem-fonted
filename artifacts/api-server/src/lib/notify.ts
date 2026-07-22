import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { notificationLogsTable, tenantsTable, type Customer } from "@workspace/db/schema";
import { resolveTemplate, renderTemplate, type NotificationEvent } from "./notification-templates";
import { getSmsProvider } from "./sms";
import { logger } from "./logger";

export const MAX_NOTIFICATION_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 60_000; // 1 minute
const RETRY_MAX_DELAY_MS = 30 * 60_000; // 30 minute cap - SMS should catch up faster than router provisioning retries

function nextBackoff(retryCount: number): Date | null {
  if (retryCount >= MAX_NOTIFICATION_ATTEMPTS) return null;
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** retryCount, RETRY_MAX_DELAY_MS);
  return new Date(Date.now() + delay);
}

/**
 * Renders the event's template (tenant override or built-in default),
 * writes one notification_logs row with the actual message body, and
 * attempts immediate delivery via whichever SMS provider is configured for
 * this tenant (lib/sms). On failure the row is left QUEUED with
 * nextRetryAt set, so services/notification-retry.ts picks it up - nothing
 * is ever silently dropped.
 *
 * This is the single place every part of the app already calls through
 * (provisioning lifecycle, OTP login, admin recharge/refill) - upgrading it
 * here means every existing call site gets real delivery, retries, and
 * status tracking without being touched individually beyond passing
 * structured variables instead of a pre-formatted string.
 */
export async function queueCustomerNotification(
  customer: Pick<Customer, "id" | "tenantId" | "phone">,
  event: NotificationEvent,
  variables: Record<string, string | number> = {},
): Promise<void> {
  const [tenant] = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, customer.tenantId)).limit(1);
  const template = await resolveTemplate(customer.tenantId, event);
  if (!template) {
    logger.warn({ customerId: customer.id, event }, "No template (tenant or default) for this notification event; nothing sent");
    return;
  }

  const body = renderTemplate(template, { tenantName: tenant?.name ?? "PulseNet", ...variables });

  const [log] = await db.insert(notificationLogsTable).values({
    tenantId: customer.tenantId,
    customerId: customer.id,
    channel: "SMS",
    recipient: customer.phone,
    body,
    eventKey: event,
    status: "SENDING",
  }).returning();

  const provider = await getSmsProvider(customer.tenantId);
  const result = await provider.send({ to: customer.phone, message: body });

  if (result.success) {
    await db.update(notificationLogsTable).set({
      status: "SENT", providerMessageId: result.providerMessageId, sentAt: new Date(), nextRetryAt: null,
    }).where(eq(notificationLogsTable.id, log.id));
  } else {
    await db.update(notificationLogsTable).set({
      status: "QUEUED", errorMessage: result.error, nextRetryAt: nextBackoff(0),
    }).where(eq(notificationLogsTable.id, log.id));
    logger.warn({ customerId: customer.id, event, error: result.error }, "SMS send failed on first attempt; queued for retry sweep");
  }
}

/** Used by the retry sweep - same send/update logic, keyed off an existing log row instead of creating a new one. */
export async function retryNotification(log: typeof notificationLogsTable.$inferSelect): Promise<void> {
  if (!log.body) {
    // Nothing to resend (e.g. a pre-upgrade row from before `body` existed) - mark it done rather than retrying forever.
    await db.update(notificationLogsTable).set({ status: "FAILED", errorMessage: "No message body recorded to retry", nextRetryAt: null }).where(eq(notificationLogsTable.id, log.id));
    return;
  }

  const provider = await getSmsProvider(log.tenantId);
  const result = await provider.send({ to: log.recipient, message: log.body });
  const retryCount = log.retryCount + 1;

  if (result.success) {
    await db.update(notificationLogsTable).set({
      status: "SENT", providerMessageId: result.providerMessageId, sentAt: new Date(), retryCount, nextRetryAt: null,
    }).where(eq(notificationLogsTable.id, log.id));
    return;
  }

  const nextRetryAt = nextBackoff(retryCount);
  await db.update(notificationLogsTable).set({
    status: nextRetryAt ? "QUEUED" : "FAILED",
    errorMessage: result.error,
    retryCount,
    nextRetryAt,
  }).where(eq(notificationLogsTable.id, log.id));
}
