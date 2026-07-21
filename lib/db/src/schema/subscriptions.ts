import { pgTable, text, boolean, timestamp, uuid, pgEnum } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";
import { customersTable } from "./customers";
import { servicePlansTable } from "./plans";
import { routersTable } from "./routers";

export const subscriptionStatusEnum = pgEnum("subscription_status", ["ACTIVE", "SUSPENDED", "OVERDUE", "EXPIRED", "CANCELLED"]);

export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => servicePlansTable.id),
  /**
   * Router this subscriber is (or should be) provisioned on. Nullable because
   * it can be resolved automatically at provisioning time from the
   * customer's site; set explicitly once provisioning succeeds, or by an
   * admin issuing a router change via POST /subscriptions/:id/reprovision.
   */
  routerId: uuid("router_id").references(() => routersTable.id, { onDelete: "set null" }),
  status: subscriptionStatusEnum("status").notNull().default("ACTIVE"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  autoRenew: boolean("auto_renew").notNull().default(false),
  /** Set the first time the expiry-reminder sweep sends a "your package expires soon" SMS, so it's never sent twice for the same billing period. Cleared implicitly whenever expiresAt moves (renewal/refill) since a new expiresAt naturally allows a fresh reminder once it again falls inside the reminder window. */
  expiryReminderSentAt: timestamp("expiry_reminder_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;
