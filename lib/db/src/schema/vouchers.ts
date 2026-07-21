import { pgTable, text, boolean, timestamp, uuid, numeric, integer, pgEnum } from "drizzle-orm/pg-core";
import { tenantsTable, sitesTable } from "./platform";
import { servicePlansTable } from "./plans";
import { customersTable } from "./customers";
import { routersTable } from "./routers";

export const voucherStatusEnum = pgEnum("voucher_status", ["UNUSED", "USED", "EXPIRED", "VOID"]);

export const voucherBatchesTable = pgTable("voucher_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => servicePlansTable.id),
  name: text("name").notNull(),
  codePrefix: text("code_prefix"),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  /** Restricts self-serve redemption (captive-portal "Redeem Voucher") to a single hotspot/router. Null = valid at any of the tenant's hotspots. Admin-initiated redemption via POST /vouchers/redeem is unaffected by this restriction. */
  routerId: uuid("router_id").references(() => routersTable.id, { onDelete: "set null" }),
  /** Restricts self-serve redemption to any hotspot at this site. If both routerId and siteId are set, a redeeming device must match both. Null = no site restriction. */
  siteId: uuid("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vouchersTable = pgTable("vouchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => voucherBatchesTable.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  status: voucherStatusEnum("status").notNull().default("UNUSED"),
  usedByCustomerId: uuid("used_by_customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  /** Populated only by self-serve captive-portal redemption (POST /portal/vouchers/redeem) — the admin redeem endpoint (POST /vouchers/redeem) leaves these null since staff perform that action on the customer's behalf. */
  redeemedMacAddress: text("redeemed_mac_address"),
  redeemedIpAddress: text("redeemed_ip_address"),
  redeemedUserAgent: text("redeemed_user_agent"),
  redeemedRouterId: uuid("redeemed_router_id").references(() => routersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VoucherBatch = typeof voucherBatchesTable.$inferSelect;
export type Voucher = typeof vouchersTable.$inferSelect;
