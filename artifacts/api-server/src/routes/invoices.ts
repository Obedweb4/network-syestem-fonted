import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { invoicesTable, paymentsTable, customersTable, walletsTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq, and, sql, desc, count } from "drizzle-orm";
import {
  ListInvoicesQueryParams, CreateInvoiceBody, GetInvoiceParams,
  UpdateInvoiceParams, UpdateInvoiceBody, GetInvoicePaymentsParams, RecordPaymentBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs whatever should happen alongside recording a COMPLETED payment,
 * inside the same transaction as the insert so a payment row can never
 * exist without its side effects (or vice versa). Shared by both
 * `POST /invoices/:id/payments` and `POST /payments` (when it's given an
 * invoiceId) — previously only the former applied these effects, so a
 * payment recorded through the standalone endpoint (which is what the
 * admin UI's "Record Payment" dialog actually calls, via the generated
 * `useRecordPayment` hook) silently never marked its invoice PAID or
 * debited a WALLET payment's balance.
 *
 * Also fixes a pre-existing bug in the invoice-PAID check: it used to
 * compare `invoice.amount` (the pre-tax subtotal, not "amount paid so
 * far") plus just this one payment against `totalAmount` — wrong for any
 * invoice with tax, and wrong for a second partial payment. This sums the
 * invoice's actual COMPLETED payments instead.
 */
async function applyPaymentEffects(tx: Tx, input: { tenantId: string; invoiceId: string | null; customerId: string; method: string; amount: string }): Promise<void> {
  const { tenantId, invoiceId, customerId, method, amount } = input;

  if (invoiceId && (method === "MPESA" || method === "CASH")) {
    const [invoice] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.tenantId, tenantId))).limit(1);
    if (invoice && invoice.status !== "PAID" && invoice.status !== "VOID") {
      const [{ paidSoFar }] = await tx.select({ paidSoFar: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)` })
        .from(paymentsTable)
        .where(and(eq(paymentsTable.invoiceId, invoiceId), eq(paymentsTable.status, "COMPLETED")));
      if (parseFloat(paidSoFar) >= parseFloat(invoice.totalAmount)) {
        await tx.update(invoicesTable).set({ status: "PAID", paidAt: new Date(), updatedAt: new Date() })
          .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.tenantId, tenantId)));
      }
    }
  }

  if (method === "WALLET") {
    const [wallet] = await tx.select().from(walletsTable).where(eq(walletsTable.customerId, customerId)).limit(1);
    if (wallet) {
      const newBalance = (parseFloat(String(wallet.balance)) - parseFloat(amount)).toFixed(2);
      await tx.update(walletsTable).set({ balance: newBalance, updatedAt: new Date() }).where(eq(walletsTable.id, wallet.id));
      await tx.insert(walletTransactionsTable).values({ walletId: wallet.id, type: "debit", amount, balanceAfter: newBalance, description: invoiceId ? "Invoice payment" : "Payment" });
    }
  }
}

router.get("/invoices", requireAuth, async (req, res) => {
  const parse = ListInvoicesQueryParams.safeParse(req.query);
  if (!parse.success) { res.status(400).json({ error: "Invalid query" }); return; }
  const { tenantId } = req.user!;
  const { page, limit, customerId, status } = parse.data;
  const offset = (page - 1) * limit;
  const conditions = [eq(invoicesTable.tenantId, tenantId)];
  if (customerId) conditions.push(eq(invoicesTable.customerId, customerId));
  if (status) conditions.push(eq(invoicesTable.status, status));
  const [rows, [{ total }]] = await Promise.all([
    db.select({ inv: invoicesTable, customerName: sql<string>`${customersTable.firstName} || ' ' || ${customersTable.lastName}` })
      .from(invoicesTable).leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
      .where(and(...conditions)).orderBy(desc(invoicesTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(invoicesTable).where(and(...conditions)),
  ]);
  res.json({ data: rows.map(r => ({ ...r.inv, customerName: r.customerName })), total: Number(total), page, limit });
});

router.post("/invoices", requireAuth, async (req, res) => {
  const parse = CreateInvoiceBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Validation failed", details: parse.error.issues }); return; }
  const { tenantId } = req.user!;
  const taxAmount = parse.data.taxAmount ?? "0";
  const total = (parseFloat(parse.data.amount) + parseFloat(taxAmount)).toFixed(2);
  const [inv] = await db.insert(invoicesTable).values({ tenantId, customerId: parse.data.customerId, subscriptionId: parse.data.subscriptionId, amount: parse.data.amount, taxAmount, totalAmount: total, notes: parse.data.notes, dueAt: parse.data.dueAt }).returning();
  res.status(201).json(inv);
});

router.get("/invoices/:id", requireAuth, async (req, res) => {
  const parse = GetInvoiceParams.safeParse(req.params);
  if (!parse.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const { tenantId } = req.user!;
  const [row] = await db.select({ inv: invoicesTable, customerName: sql<string>`${customersTable.firstName} || ' ' || ${customersTable.lastName}` })
    .from(invoicesTable).leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(and(eq(invoicesTable.id, parse.data.id), eq(invoicesTable.tenantId, tenantId))).limit(1);
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json({ ...row.inv, customerName: row.customerName });
});

router.patch("/invoices/:id", requireAuth, async (req, res) => {
  const paramParse = UpdateInvoiceParams.safeParse(req.params);
  const bodyParse = UpdateInvoiceBody.safeParse(req.body);
  if (!paramParse.success || !bodyParse.success) { res.status(400).json({ error: "Validation failed" }); return; }
  const { tenantId } = req.user!;
  const [updated] = await db.update(invoicesTable).set({ ...bodyParse.data, updatedAt: new Date() })
    .where(and(eq(invoicesTable.id, paramParse.data.id), eq(invoicesTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json(updated);
});

router.get("/invoices/:id/payments", requireAuth, async (req, res) => {
  const parse = GetInvoicePaymentsParams.safeParse(req.params);
  if (!parse.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const { tenantId } = req.user!;
  // Verify invoice belongs to this tenant before exposing payment records
  const [inv] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(eq(invoicesTable.id, parse.data.id), eq(invoicesTable.tenantId, tenantId))).limit(1);
  if (!inv) { res.status(404).json({ error: "Invoice not found" }); return; }
  const payments = await db.select().from(paymentsTable)
    .where(and(eq(paymentsTable.invoiceId, parse.data.id), eq(paymentsTable.tenantId, tenantId)))
    .orderBy(desc(paymentsTable.createdAt));
  res.json(payments);
});

router.post("/invoices/:id/payments", requireAuth, async (req, res) => {
  const parse = RecordPaymentBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Validation failed", details: parse.error.issues }); return; }
  const { tenantId } = req.user!;
  const invId = String(req.params.id);
  // Verify invoice ownership before writing
  const [inv] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, invId), eq(invoicesTable.tenantId, tenantId))).limit(1);
  if (!inv) { res.status(404).json({ error: "Invoice not found" }); return; }

  const payment = await db.transaction(async (tx) => {
    const [row] = await tx.insert(paymentsTable).values({ tenantId, customerId: parse.data.customerId, invoiceId: invId, amount: parse.data.amount, method: parse.data.method, reference: parse.data.reference, status: "COMPLETED" }).returning();
    await applyPaymentEffects(tx, { tenantId, invoiceId: invId, customerId: parse.data.customerId, method: parse.data.method, amount: parse.data.amount });
    return row;
  });
  res.status(201).json(payment);
});

/** POST /payments — standalone payment record (operationId: recordPayment). This is what the admin UI's invoice "Record Payment" dialog actually calls (see invoices.tsx), so it applies the same effects as the invoice-scoped route above whenever an invoiceId is given. */
router.post("/payments", requireAuth, async (req, res) => {
  const parse = RecordPaymentBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Validation failed", details: parse.error.issues }); return; }
  const { tenantId } = req.user!;

  const payment = await db.transaction(async (tx) => {
    const [row] = await tx.insert(paymentsTable).values({
      tenantId,
      customerId: parse.data.customerId,
      invoiceId: parse.data.invoiceId ?? null,
      amount: parse.data.amount,
      method: parse.data.method,
      reference: parse.data.reference ?? null,
      status: "COMPLETED",
    }).returning();
    await applyPaymentEffects(tx, { tenantId, invoiceId: parse.data.invoiceId ?? null, customerId: parse.data.customerId, method: parse.data.method, amount: parse.data.amount });
    return row;
  });
  res.status(201).json(payment);
});

/** Admin payment report: totals by method/status plus latest transactions. */
router.get("/payments/report", requireAuth, async (req, res) => {
  const tenantId = req.user!.tenantId;
  const [totals, byMethod, recent] = await Promise.all([
    db.select({ received: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)`, count: count() })
      .from(paymentsTable).where(and(eq(paymentsTable.tenantId, tenantId), eq(paymentsTable.status, "COMPLETED"))),
    db.select({ method: paymentsTable.method, total: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)`, count: count() })
      .from(paymentsTable).where(eq(paymentsTable.tenantId, tenantId)).groupBy(paymentsTable.method),
    db.select({ payment: paymentsTable, customerName: sql<string>`${customersTable.firstName} || ' ' || ${customersTable.lastName}` })
      .from(paymentsTable).leftJoin(customersTable, eq(customersTable.id, paymentsTable.customerId))
      .where(eq(paymentsTable.tenantId, tenantId)).orderBy(desc(paymentsTable.createdAt)).limit(50),
  ]);
  res.json({ totalReceived: Number(totals[0]?.received ?? 0), paymentCount: Number(totals[0]?.count ?? 0), byMethod: byMethod.map(r => ({ ...r, total: Number(r.total), count: Number(r.count) })), recent: recent.map(r => ({ ...r.payment, amount: Number(r.payment.amount), customerName: r.customerName })) });
});

export default router;
