import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";
import { subscriptionsTable, subscriptionStatusEnum } from "./subscriptions";
import { usersTable } from "./users";

/**
 * Append-only log of every subscription status change (ACTIVE -> SUSPENDED,
 * SUSPENDED -> ACTIVE, ACTIVE -> EXPIRED, etc), written exclusively by
 * services/provisioning-engine.ts so every transition — whatever triggered
 * it (payment, expiry sweep, admin action, plan change) — lands here with a
 * reason and, when a staff member did it, who. `actorUserId` is null for
 * system-triggered transitions (expiry sweep, payment callback).
 */
export const subscriptionStatusHistoryTable = pgTable("subscription_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  fromStatus: subscriptionStatusEnum("from_status"),
  toStatus: subscriptionStatusEnum("to_status").notNull(),
  reason: text("reason").notNull(),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionStatusHistory = typeof subscriptionStatusHistoryTable.$inferSelect;
