import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { mpesaTransactionLogsTable, stkPushRequestsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { parseStkCallback } from "../lib/mpesa";
import { activatePaymentFromCallback } from "../services/payment-activation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Safaricom Daraja calls this URL directly (it's what MPESA_CALLBACK_URL
 * must point at) — there is no Authorization header and no Origin header,
 * so this route intentionally sits outside requireAuth/requireCustomerAuth.
 * "Verification" here means structural validation of the payload (it must
 * match Daraja's documented STK callback shape and reference a
 * checkoutRequestId this system actually created) rather than a shared
 * secret, because Daraja does not sign or otherwise authenticate callbacks.
 * Restricting inbound traffic to Safaricom's published IP ranges at the
 * load balancer/firewall is the network-level control for this endpoint —
 * see DEPLOYMENT.md.
 *
 * Always responds 200 with {"ResultCode":0} — Daraja retries on anything
 * else, which would just replay a callback this system already logged (and,
 * once processed, already ignores as a duplicate).
 */
router.post("/payments/mpesa/callback", async (req, res) => {
  const parsed = parseStkCallback(req.body);

  if (!parsed) {
    logger.warn({ body: req.body }, "Received M-PESA callback that does not match the expected Daraja shape");
    await db.insert(mpesaTransactionLogsTable).values({ type: "CALLBACK_REJECTED", payload: safePayload(req.body) }).catch(() => {});
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    return;
  }

  // Attribute the log entry to the right tenant/push row when we can find one — best-effort, never blocks processing.
  const [push] = await db.select({ id: stkPushRequestsTable.id, tenantId: stkPushRequestsTable.tenantId })
    .from(stkPushRequestsTable)
    .where(eq(stkPushRequestsTable.checkoutRequestId, parsed.checkoutRequestId))
    .limit(1);

  await db.insert(mpesaTransactionLogsTable).values({
    tenantId: push?.tenantId, stkPushRequestId: push?.id, type: "CALLBACK_RECEIVED",
    checkoutRequestId: parsed.checkoutRequestId, payload: safePayload(req.body),
  }).catch((err) => logger.error({ err }, "Failed to log inbound M-PESA callback"));

  try {
    const result = await activatePaymentFromCallback(parsed);
    await db.insert(mpesaTransactionLogsTable).values({
      tenantId: push?.tenantId, stkPushRequestId: push?.id, type: "CALLBACK_PROCESSED",
      checkoutRequestId: parsed.checkoutRequestId, payload: { outcome: result.outcome },
    }).catch(() => {});
  } catch (err) {
    // Never let a processing error surface a non-200 to Safaricom — log it
    // loudly instead; the stk_push_request stays PENDING so it can be
    // reconciled manually (see DEPLOYMENT.md) or reprocessed if Daraja retries.
    logger.error({ err, checkoutRequestId: parsed.checkoutRequestId }, "Failed to process M-PESA callback");
  }

  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/** Strips nothing sensitive currently exists in the callback body, but keeps this centralized in case Daraja ever includes it. */
function safePayload(body: unknown): Record<string, unknown> {
  return (body && typeof body === "object" ? body : { raw: body }) as Record<string, unknown>;
}

export default router;
