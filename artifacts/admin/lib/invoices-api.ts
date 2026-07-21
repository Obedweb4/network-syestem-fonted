import { customFetch } from "@workspace/api-client-react";
import type { Payment, PaymentInput } from "@workspace/api-client-react";

/**
 * POST /invoices/:id/payments — documented in openapi.yaml as
 * `recordInvoicePayment`, but not yet regenerated into a hook, so this is
 * a hand-written equivalent of what `pnpm generate:api` would produce.
 *
 * Use this (not the generated `useRecordPayment`, which hits the standalone
 * `POST /payments`) whenever paying a specific invoice — both endpoints
 * apply the same PAID-status/WALLET-debit side effects server-side now, but
 * this one also 404s cleanly on an invoice from another tenant instead of
 * silently accepting an invoiceId that doesn't belong to the caller.
 */
export function recordInvoicePayment(invoiceId: string, data: PaymentInput) {
  return customFetch<Payment>(`/api/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export interface PaymentsReportDto {
  totalReceived: number;
  paymentCount: number;
  byMethod: { method: string; total: number; count: number }[];
  recent: (Payment & { customerName: string | null })[];
}

/** GET /payments/report — powers the Invoices page's Reports tab. */
export function fetchPaymentsReport() {
  return customFetch<PaymentsReportDto>("/api/payments/report", { responseType: "json" });
}
