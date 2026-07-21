import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";
import { usersTable } from "./users";

/**
 * Append-only trail of security-relevant events: logins, failed logins,
 * lockouts, password resets, role changes, approvals, session revocations.
 * tenantId/userId are nullable so pre-auth events (e.g. a failed login for
 * an email that doesn't exist) can still be recorded without a foreign key.
 */
export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;
