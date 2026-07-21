import { pgTable, text, timestamp, uuid, numeric, pgEnum } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";
import { customersTable } from "./customers";
import { subscriptionsTable } from "./subscriptions";

export const invoiceStatusEnum = pgEnum("invoice_status", ["DRAFT", "PENDING", "PAID", "VOID"]);
export const paymentMethodEnum = pgEnum("payment_method", ["MPESA", "WALLET", "LOYALTY", "CASH"]);
export const paymentStatusEnum = pgEnum("payment_status", ["PENDING", "COMPLETED", "FAILED", "REFUNDED"]);

export const invoicesTable = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptionsTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("PENDING"),
  notes: text("notes"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentsTable = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: paymentMethodEnum("method").notNull(),
  reference: text("reference"),
  status: paymentStatusEnum("status").notNull().default("COMPLETED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Invoice = typeof invoicesTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
