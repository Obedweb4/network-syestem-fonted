import { customFetch } from "@workspace/api-client-react";

/**
 * POST /customers/:id/recharge and POST /customers/:id/refill — real
 * backend routes (routes/customers.ts) with no generated hook, same
 * situation as recordInvoicePayment in invoices-api.ts. There was
 * previously no UI anywhere calling either of these.
 */

export interface RechargeResult {
  customerId: string;
  balance: number;
  message: string;
}

/** Credits a customer's prepaid wallet by a fixed amount (admin-initiated, e.g. a cash top-up). */
export function rechargeWallet(customerId: string, data: { amount: number; reference?: string }) {
  return customFetch<RechargeResult>(`/api/customers/${customerId}/recharge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export interface RefillResult {
  subscription: unknown;
  message: string;
}

/** Extends a customer's active subscription by N days without changing plan speed or price. 409s if they have no active subscription. */
export function refillSubscription(customerId: string, data: { days: number }) {
  return customFetch<RefillResult>(`/api/customers/${customerId}/refill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export interface LoyaltyAdjustResult {
  customerId: string;
  balance: number;
  message: string;
}

/** Manually adjusts a customer's Loyalty Points balance — positive to credit (bonus), negative to debit (correction). Automatic earning from payments happens server-side on every successful subscription payment; this is the human-initiated exception path. */
export function adjustLoyaltyPoints(customerId: string, data: { points: number; reason?: string }) {
  return customFetch<LoyaltyAdjustResult>(`/api/customers/${customerId}/loyalty-adjust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
