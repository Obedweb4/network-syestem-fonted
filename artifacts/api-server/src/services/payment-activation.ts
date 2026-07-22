import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  stkPushRequestsTable, invoicesTable, paymentsTable,
  customersTable, servicePlansTable, type Subscription,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";
import type { ParsedStkCallback } from "../lib/mpesa";
import { provisionSubscription } from "./provisioning-engine";
import { renewOrCreateSubscription } from "./subscription-lifecycle";

export type ActivationOutcome =
  | { outcome: "not_found" }
  | { outcome: "already_processed" }
  | { outcome: "duplicate_receipt" }
  | { outcome: "failed" }
  | { outcome: "activated"; subscriptionId: string; invoiceId: string };

/**
 * Processes one Daraja STK callback end-to-end. Safe to call more than once
 * with the same callback body (Safaricom retries callbacks) — everything
 * that changes billing state happens inside a single row-locked transaction
 * keyed on `checkoutRequestId`, so a retried or duplicated callback is a
 * no-op the second time. Provisioning and notification are deliberately
 * *outside* that transaction (they're network calls, not DB writes) and are
 * best-effort: a router being unreachable must never roll back a payment
 * that already succeeded.
 */
export async function activatePaymentFromCallback(callback: ParsedStkCallback): Promise<ActivationOutcome> {
  const activation = await db.transaction(async (tx) => {
    const [push] = await tx
      .select()
      .from(stkPushRequestsTable)
      .where(eq(stkPushRequestsTable.checkoutRequestId, callback.checkoutRequestId))
      .for("update")
      .limit(1);

    if (!push) return { outcome: "not_found" as const };
    if (push.processedAt || push.status !== "PENDING") return { outcome: "already_processed" as const };

    if (!callback.success) {
      await tx.update(stkPushRequestsTable).set({
        status: "FAILED",
        resultCode: callback.resultCode,
        resultDesc: callback.resultDesc,
        merchantRequestId: callback.merchantRequestId,
        failureReason: callback.resultDesc,
        processedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(stkPushRequestsTable.id, push.id));
      return { outcome: "failed" as const };
    }

    // A receipt number must never activate two different push requests —
    // guards against a callback being replayed against a second (stale) row.
    if (callback.mpesaReceiptNumber) {
      const [reused] = await tx.select({ id: stkPushRequestsTable.id })
        .from(stkPushRequestsTable)
        .where(eq(stkPushRequestsTable.mpesaReceiptNumber, callback.mpesaReceiptNumber))
        .limit(1);
      if (reused) return { outcome: "duplicate_receipt" as const };
    }

    const [plan] = await tx.select().from(servicePlansTable).where(eq(servicePlansTable.id, push.planId)).limit(1);
    const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, push.customerId)).limit(1);
    if (!plan || !customer) {
      await tx.update(stkPushRequestsTable).set({
        status: "FAILED", failureReason: "Plan or customer no longer exists", processedAt: new Date(), updatedAt: new Date(),
      }).where(eq(stkPushRequestsTable.id, push.id));
      return { outcome: "failed" as const };
    }

    const now = new Date();

    const [invoice] = await tx.insert(invoicesTable).values({
      tenantId: push.tenantId,
      customerId: customer.id,
      amount: push.amount,
      taxAmount: "0",
      totalAmount: push.amount,
      status: "PAID",
      dueAt: now,
      paidAt: now,
      notes: callback.mpesaReceiptNumber ? `M-PESA ${callback.mpesaReceiptNumber}` : "M-PESA payment",
    }).returning();

    await tx.insert(paymentsTable).values({
      tenantId: push.tenantId,
      customerId: customer.id,
      invoiceId: invoice.id,
      amount: push.amount,
      method: "MPESA",
      reference: callback.mpesaReceiptNumber ?? callback.checkoutRequestId,
      status: "COMPLETED",
    });

    // Renew the customer's existing active subscription to this plan if they
    // have one (extends from the later of "now" or its current expiry, so
    // paying early doesn't waste remaining time); otherwise start a new one.
    // Shared with self-serve voucher redemption — see subscription-lifecycle.ts.
    const subscription: Subscription = await renewOrCreateSubscription(tx, {
      tenantId: push.tenantId, customerId: customer.id, planId: plan.id, durationDays: plan.durationDays, amountPaid: Number(push.amount),
    });

    await tx.update(invoicesTable).set({ subscriptionId: subscription.id }).where(eq(invoicesTable.id, invoice.id));

    await tx.update(stkPushRequestsTable).set({
      status: "COMPLETED",
      resultCode: callback.resultCode,
      resultDesc: callback.resultDesc,
      merchantRequestId: callback.merchantRequestId,
      mpesaReceiptNumber: callback.mpesaReceiptNumber,
      transactionDate: callback.transactionDate,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      processedAt: now,
      updatedAt: now,
    }).where(eq(stkPushRequestsTable.id, push.id));

    return { outcome: "activated" as const, plan, customer, subscription, invoice, push };
  });

  if (activation.outcome !== "activated") {
    if (activation.outcome === "not_found") logger.warn({ checkoutRequestId: callback.checkoutRequestId }, "M-PESA callback for unknown checkoutRequestId");
    else if (activation.outcome === "already_processed") logger.info({ checkoutRequestId: callback.checkoutRequestId }, "M-PESA callback already processed; ignoring duplicate delivery");
    else if (activation.outcome === "duplicate_receipt") logger.warn({ checkoutRequestId: callback.checkoutRequestId, receipt: callback.mpesaReceiptNumber }, "M-PESA receipt number reused across push requests; second activation blocked");
    else logger.info({ checkoutRequestId: callback.checkoutRequestId, resultDesc: callback.resultDesc }, "M-PESA payment failed or was cancelled by the customer");
    return activation;
  }

  const { subscription, push } = activation;
  logger.info({ subscriptionId: subscription.id }, "Payment activated; triggering router provisioning");

  // provisionSubscription() is idempotent and, if the subscription was
  // previously SUSPENDED (e.g. paid after going overdue), automatically
  // reactivates the existing router account instead of creating a new one
  // — this is what makes "successful payment restores access" work for
  // both a brand-new subscriber and a returning one. Passing the MAC
  // captured at checkout (if any) is what lets a HOTSPOT payment result in
  // the paying device being granted access directly via a RouterOS
  // ip-binding, with no username/password ever generated for the customer
  // to enter.
  await provisionSubscription(subscription.id, {}, push.macAddress).catch((err) =>
    logger.error({ err, subscriptionId: subscription.id }, "Provisioning after payment failed; subscription remains ACTIVE for manual/retry-sweep provisioning"),
  );

  return { outcome: "activated", subscriptionId: subscription.id, invoiceId: activation.invoice.id };
}
