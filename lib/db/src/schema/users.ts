import { pgTable, text, boolean, timestamp, uuid, integer, pgEnum, type AnyPgColumn } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";

/**
 * Canonical staff/business roles. A user normally holds exactly one of these
 * in `roles`, but the column stays an array for forward compatibility with
 * multi-role assignment. PENDING_APPROVAL / REJECTED are account `status`
 * values, not roles — a pending user has no role until approved.
 */
export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  BUSINESS_OWNER: "BUSINESS_OWNER",
  STAFF: "STAFF",
  TECHNICIAN: "TECHNICIAN",
  RESELLER: "RESELLER",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];
export const ALL_ROLES: Role[] = Object.values(ROLES);

export const userStatusEnum = pgEnum("user_status", [
  "PENDING_APPROVAL",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
]);

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  businessLocation: text("business_location"),
  roles: text("roles").array().notNull().default(["staff"]),
  /** Account approval/lifecycle state. New self-registrations start PENDING_APPROVAL. */
  status: userStatusEnum("status").notNull().default("ACTIVE"),
  isActive: boolean("is_active").notNull().default(true),

  // --- Account lockout / brute-force protection ---
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),

  // --- Two-factor authentication (TOTP) ---
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  twoFactorSecret: text("two_factor_secret"),

  // --- Approval trail ---
  approvedBy: uuid("approved_by").references((): AnyPgColumn => usersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokensTable = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // --- Device / session tracking ---
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type RefreshToken = typeof refreshTokensTable.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
