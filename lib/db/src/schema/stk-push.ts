import { pgTable, text, timestamp, uuid, numeric, pgEnum, integer } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";
import { customersTable } from "./customers";
import { servicePlansTable } from "./plans";

export const stkPushStatusEnum = pgEnum("stk_push_status", [
  "PENDING",
  "COMPLETED",
  "FAILED",
]);

/**
 * Tracks a real M-PESA STK Push request initiated from the captive portal /
 * customer portal "Buy" flow. `checkoutRequestId` and `merchantRequestId`
 * are populated from Safaricom's Daraja `STKPushRequest` response; `status`,
 * `resultCode`, `resultDesc`, `mpesaReceiptNumber` and `transactionDate` are
 * populated from the Daraja callback (`POST /payments/mpesa/callback`).
 *
 * `status: COMPLETED` is this system's "payment succeeded" state — kept as
 * COMPLETED rather than renamed to SUCCESS so the enum, existing rows, and
 * `routes/portal.ts` response mapping don't need a breaking rename.
 */
export const stkPushRequestsTable = pgTable("stk_push_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => servicePlansTable.id),
  phone: text("phone").notNull(),
  /** Normalized (uppercase) MAC address of the device that initiated checkout, captured from RouterOS's `$(mac)` hotspot template variable via the captive portal. Null for purchases made outside the captive portal (e.g. customer-portal app on an already-authorized connection), where there is nothing to bind. Used post-payment to create a RouterOS `/ip/hotspot/ip-binding` entry so the device is granted access with no credentials shown. */
  macAddress: text("mac_address"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  checkoutRequestId: text("checkout_request_id").notNull().unique(),
  merchantRequestId: text("merchant_request_id"),
  status: stkPushStatusEnum("status").notNull().default("PENDING"),
  resultCode: integer("result_code"),
  resultDesc: text("result_desc"),
  mpesaReceiptNumber: text("mpesa_receipt_number").unique(),
  transactionDate: text("transaction_date"),
  failureReason: text("failure_reason"),
  subscriptionId: uuid("subscription_id"),
  invoiceId: uuid("invoice_id"),
  /** Set once the callback has finished activating billing + provisioning; guards against double-processing a retried callback. */
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StkPushRequest = typeof stkPushRequestsTable.$inferSelect;
