import { and, eq, lte, or, isNull, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { notificationLogsTable } from "@workspace/db/schema";
import { retryNotification, MAX_NOTIFICATION_ATTEMPTS } from "../lib/notify";
import { logger } from "../lib/logger";

/**
 * Finds notification_logs rows that are QUEUED (failed at least once, or
 * never successfully sent) and due for a retry per the backoff schedule set
 * in lib/notify.ts, and retries each one. Rows that have hit
 * MAX_NOTIFICATION_ATTEMPTS are already marked FAILED by retryNotification
 * and excluded here — "Failed" is a terminal state this sweep leaves alone,
 * per the "never silently discard, but don't retry forever either" flow.
 */
export async function retryFailedNotifications(): Promise<void> {
  const now = new Date();
  const candidates = await db.select().from(notificationLogsTable)
    .where(and(
      eq(notificationLogsTable.status, "QUEUED"),
      lt(notificationLogsTable.retryCount, MAX_NOTIFICATION_ATTEMPTS),
      or(isNull(notificationLogsTable.nextRetryAt), lte(notificationLogsTable.nextRetryAt, now)),
    ));

  for (const log of candidates) {
    await retryNotification(log).catch((err) => logger.error({ err, notificationId: log.id }, "Notification retry threw unexpectedly"));
  }
}

/** Starts a non-overlapping background sweep retrying queued/failed SMS notifications. */
export function startNotificationRetrySweep(intervalMs = 60_000): void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await retryFailedNotifications();
    } finally {
      running = false;
    }
  };
  void sweep();
  setInterval(() => void sweep(), intervalMs).unref();
}
