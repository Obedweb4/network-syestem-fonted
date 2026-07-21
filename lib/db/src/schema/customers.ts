import { pgTable, text, boolean, timestamp, uuid, numeric, integer, smallint } from "drizzle-orm/pg-core";
import { tenantsTable, sitesTable } from "./platform";

export const customersTable = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone").notNull(),
  nationalId: text("national_id"),
  address: text("address"),
  accountNumber: text("account_number").unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletsTable = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().unique().references(() => customersTable.id, { onDelete: "cascade" }),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("KES"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletId: uuid("wallet_id").notNull().references(() => walletsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }).notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loyaltyAccountsTable = pgTable("loyalty_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().unique().references(() => customersTable.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  lifetimeEarned: integer("lifetime_earned").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loyaltyTransactionsTable = pgTable("loyalty_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  loyaltyAccountId: uuid("loyalty_account_id").notNull().references(() => loyaltyAccountsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  points: integer("points").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerPortalRefreshTokensTable = pgTable("customer_portal_refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One-time codes for optional customer sign-in. A customer never sets a
 * password — knowing their phone number is not sufficient to sign in,
 * because that number never leaves the tenant's own SMS gateway; only the
 * hash of the code is stored, the same way refresh tokens are hashed at
 * rest. `attempts` bounds guessing per code independent of the route-level
 * rate limiter (defense in depth for a 6-digit space).
 */
export const customerOtpCodesTable = pgTable("customer_otp_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  attempts: smallint("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Customer = typeof customersTable.$inferSelect;
export type Wallet = typeof walletsTable.$inferSelect;
export type LoyaltyAccount = typeof loyaltyAccountsTable.$inferSelect;
export type CustomerPortalRefreshToken = typeof customerPortalRefreshTokensTable.$inferSelect;
export type CustomerOtpCode = typeof customerOtpCodesTable.$inferSelect;
