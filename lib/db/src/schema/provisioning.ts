import { pgTable, text, timestamp, uuid, pgEnum, integer } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";
import { subscriptionsTable } from "./subscriptions";
import { routersTable } from "./routers";
import { customersTable } from "./customers";

/**
 * Enum for provisioning status tracking
 */
export const provisioningStatusEnum = pgEnum("provisioning_status", [
  "PENDING",
  "IN_PROGRESS",
  "SUCCESS",
  "FAILED",
  "SUSPENDED",
  "DEPROVISIONED",
]);

/**
 * State of the RouterOS-native `/ip/hotspot/ip-binding` (type=bypassed)
 * entry that grants a HOTSPOT subscriber's device network access without
 * ever presenting the captive login page. Tracked independently from
 * `status` above because a hotspot user account can provision successfully
 * (SUCCESS) while the device binding itself is still pending/failed/retrying
 * — e.g. payment came from a channel that didn't capture a MAC address yet.
 */
export const ipBindingStatusEnum = pgEnum("ip_binding_status", [
  "NOT_APPLICABLE", // PPPoE subscriptions, or no MAC captured yet
  "PENDING",
  "BOUND",
  "SUSPENDED", // binding exists on the router but disabled=yes
  "FAILED",
  "REMOVED",
]);

/**
 * Tracks provisioning state of subscriptions on routers
 * Bridges subscriptions to their router-side provisioning status
 *
 * Example:
 * - Subscription created (status: ACTIVE) → provisioning status: IN_PROGRESS
 * - PPPoE user created on router → provisioning status: SUCCESS
 * - User queries router → provisioning status: verifies user still exists
 * - Subscription suspended → provisioning status: SUSPENDED
 */
export const provisioningMappingsTable = pgTable("provisioning_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .unique()
    .references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  routerId: uuid("router_id")
    .notNull()
    .references(() => routersTable.id, { onDelete: "restrict" }),

  // Router-side credentials (non-secret, username only)
  routerUsername: text("router_username").notNull(),
  /** AES-256-GCM ciphertext (see lib/provisioning-credentials.ts) of the current PPPoE/Hotspot password. Never returned by any GET endpoint — only by the reset-password action, once, right after generating it. */
  pppoePasswordEncrypted: text("pppoe_password_encrypted"),
  pppoePasswordUpdatedAt: timestamp("pppoe_password_updated_at", { withTimezone: true }),
  /** The PPP/Hotspot user profile this account is currently configured with on the router — derived from the plan, tracked explicitly so plan/router changes know what to update or recreate. */
  mikrotikProfileName: text("mikrotik_profile_name"),

  // Provisioning state
  status: provisioningStatusEnum("status").notNull().default("PENDING"),

  // Retry/backoff (see services/provisioning-retry.ts)
  attemptCount: integer("attempt_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),

  // --- MAC/IP-bound Hotspot access (RouterOS `/ip/hotspot/ip-binding`,
  // type=bypassed). This is what lets a HOTSPOT customer get online purely
  // because their device's MAC was seen paying, with no username/password
  // ever shown to them. Independent attempt/backoff tracking from the
  // hotspot-user fields above, since the two can fail independently. ---
  /** Normalized (uppercase) MAC of the device currently authorized for this subscription. Null until a payment/checkout has captured one. */
  boundMacAddress: text("bound_mac_address"),
  ipBindingStatus: ipBindingStatusEnum("ip_binding_status").notNull().default("NOT_APPLICABLE"),
  /** RouterOS `.id` of the `/ip/hotspot/ip-binding` entry, cached for fast set/remove; the source of truth is always re-verified by mac-address lookup, never trusted blindly. */
  ipBindingRouterEntryId: text("ip_binding_router_entry_id"),
  ipBindingAttemptCount: integer("ip_binding_attempt_count").notNull().default(0),
  ipBindingNextRetryAt: timestamp("ip_binding_next_retry_at", { withTimezone: true }),
  ipBindingLastError: text("ip_binding_last_error"),
  ipBindingLastErrorCode: text("ip_binding_last_error_code"),
  ipBindingBoundAt: timestamp("ip_binding_bound_at", { withTimezone: true }),

  // Audit trail
  lastProvisioningAttempt: timestamp("last_provisioning_attempt", {
    withTimezone: true,
  }),
  lastProvisioningError: text("last_provisioning_error"),
  lastProvisioningErrorCode: text("last_provisioning_error_code"),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  deprovisionedAt: timestamp("deprovisioned_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Audit log for all provisioning operations
 * Immutable record of what happened and when
 *
 * Used for:
 * - Troubleshooting provisioning failures
 * - Compliance/audit trails
 * - Performance analysis
 * - Debugging customer issues
 */
export const provisioningAuditLogsTable = pgTable("provisioning_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  routerId: uuid("router_id")
    .notNull()
    .references(() => routersTable.id, { onDelete: "restrict" }),

  // Action type
  action: text("action").notNull(), // PROVISION, DEPROVISION, SUSPEND, RESUME

  // Result
  status: text("status").notNull(), // SUCCESS, FAILED
  routerUsername: text("router_username"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),

  // Performance tracking
  durationMs: integer("duration_ms"),

  // Timeline
  executedAt: timestamp("executed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProvisioningMapping = typeof provisioningMappingsTable.$inferSelect;
export type ProvisioningAuditLog =
  typeof provisioningAuditLogsTable.$inferSelect;
