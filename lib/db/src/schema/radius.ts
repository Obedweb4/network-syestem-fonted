import { pgTable, text, boolean, timestamp, uuid, integer, bigint, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";
import { routersTable } from "./routers";
import { customersTable } from "./customers";
import { subscriptionsTable } from "./subscriptions";

/**
 * PulseNet Centralized RADIUS (AAA)
 * ─────────────────────────────────
 * This file is the data layer for RADIUS Authentication, Authorization and
 * Accounting. It deliberately does NOT duplicate anything that already
 * exists:
 *
 * - NAS (Network Access Server) records are the existing `routers` table
 *   (routers.ts) — a MikroTik router already *is* a NAS. This file only adds
 *   RADIUS-specific columns to it (see routers.ts changes) rather than
 *   creating a parallel "nas_clients" table.
 * - Plan-level authorization attributes (bandwidth, session/idle timeout,
 *   IP pool, address-list, VLAN) are added as columns on the existing
 *   `service_plans` table (plans.ts) — the plan a customer is subscribed to
 *   is already the single source of truth for what they're entitled to; a
 *   separate "radius profile" table would just be a second place the same
 *   fact could drift out of sync.
 * - Router-side credentials (username + encrypted password) are the
 *   existing `provisioning_mappings` table (provisioning.ts) — RADIUS
 *   authenticates PPPoE/Hotspot users against exactly the same secret the
 *   MikroTik provisioning engine already created on the router, so a
 *   customer's credentials are never generated or stored twice.
 * - Live/ephemeral session polling for the MAC-bound walled-garden Hotspot
 *   flow keeps using `hotspot_sessions` (routers.ts) unchanged — that table
 *   is a RouterOS-poll cache for customers who never go through RADIUS at
 *   all (payment captured a MAC, no username/password ever shown). It has
 *   no session-timeout/idle-timeout/NAS/terminate-cause concept because it
 *   was never meant to be an AAA accounting ledger.
 *
 * What's genuinely new here (nothing in the codebase persists this today):
 * - `radius_server_config`: one row per tenant — the on/off switch and
 *   default ports/secret for RADIUS, surfaced at Admin > RADIUS.
 * - `radius_auth_events`: immutable log of every Access-Request decision
 *   (accept or reject + why) — powers "Failed authentications" / auth audit.
 * - `radius_accounting`: the durable Start/Interim-Update/Stop ledger for
 *   BOTH PPPoE and Hotspot sessions authenticated via RADIUS — session
 *   duration, bytes in/out, NAS info, disconnect reason. This is what makes
 *   "Online users", "Accounting logs", and the customer portal's PPPoE
 *   session history possible; today only Hotspot's MAC-bound flow has any
 *   session record at all, and even that one lacks these fields.
 */

export const radiusPacketResultEnum = pgEnum("radius_packet_result", ["ACCESS_ACCEPT", "ACCESS_REJECT"]);
export const radiusSessionTypeEnum = pgEnum("radius_session_type", ["PPPOE", "HOTSPOT"]);
export const radiusSessionStatusEnum = pgEnum("radius_session_status", ["ACTIVE", "STOPPED"]);

// ---------------------------------------------------------------------------
// Tenant-wide RADIUS server configuration
// ---------------------------------------------------------------------------

export const radiusServerConfigTable = pgTable("radius_server_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenantsTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  authPort: integer("auth_port").notNull().default(1812),
  acctPort: integer("acct_port").notNull().default(1813),
  /** AES-256-GCM ciphertext (lib/provisioning-credentials.ts) of the tenant-wide default RADIUS shared secret. A NAS (router) can override this with its own routers.radiusSecretEncrypted; when that's null, this default is used. */
  defaultSecretEncrypted: text("default_secret_encrypted"),
  /** Fallback authorization attributes applied when the subscriber's plan doesn't set its own (see plans.ts: sessionTimeoutSec / idleTimeoutSec / framedPool). */
  defaultSessionTimeoutSec: integer("default_session_timeout_sec"),
  defaultIdleTimeoutSec: integer("default_idle_timeout_sec"),
  defaultFramedPool: text("default_framed_pool"),
  /** Accounting Interim-Update interval (seconds) advertised to NAS devices that honor Acct-Interim-Interval; purely advisory since RouterOS also has its own local setting. */
  interimUpdateIntervalSec: integer("interim_update_interval_sec").notNull().default(300),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Authentication audit trail
// ---------------------------------------------------------------------------

export const radiusAuthEventsTable = pgTable("radius_auth_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  /** NAS the Access-Request arrived from. Nullable only for the rare case a packet's source IP matched no configured router (logged for visibility, not attributable to one). */
  routerId: uuid("router_id").references(() => routersTable.id, { onDelete: "set null" }),
  customerId: uuid("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptionsTable.id, { onDelete: "set null" }),
  username: text("username").notNull(),
  nasIpAddress: text("nas_ip_address"),
  callingStationId: text("calling_station_id"), // client MAC, when the NAS sends one
  result: radiusPacketResultEnum("result").notNull(),
  /** Machine-readable reason: unknown_user, subscription_suspended, subscription_expired, subscription_cancelled, bad_password, nas_unrecognized, nas_secret_mismatch, ok */
  reasonCode: text("reason_code").notNull(),
  reasonMessage: text("reason_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantCreatedIdx: index("radius_auth_events_tenant_created_idx").on(t.tenantId, t.createdAt),
  resultIdx: index("radius_auth_events_result_idx").on(t.tenantId, t.result, t.createdAt),
}));

// ---------------------------------------------------------------------------
// Accounting ledger (Start / Interim-Update / Stop)
// ---------------------------------------------------------------------------

export const radiusAccountingTable = pgTable("radius_accounting", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  routerId: uuid("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }), // NAS
  customerId: uuid("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptionsTable.id, { onDelete: "set null" }),
  sessionType: radiusSessionTypeEnum("session_type").notNull(),
  status: radiusSessionStatusEnum("status").notNull().default("ACTIVE"),
  username: text("username").notNull(),
  /** RADIUS Acct-Session-Id as sent by the NAS. Unique per NAS — Interim-Update/Stop packets are matched back to the row Start created via (routerId, acctSessionId), never by username alone (a user can have overlapping start/stop packets during a fast reconnect). */
  acctSessionId: text("acct_session_id").notNull(),
  nasIpAddress: text("nas_ip_address"),
  nasPortId: text("nas_port_id"),
  callingStationId: text("calling_station_id"), // client MAC
  framedIpAddress: text("framed_ip_address"),
  bytesIn: bigint("bytes_in", { mode: "number" }).notNull().default(0),
  bytesOut: bigint("bytes_out", { mode: "number" }).notNull().default(0),
  packetsIn: bigint("packets_in", { mode: "number" }).notNull().default(0),
  packetsOut: bigint("packets_out", { mode: "number" }).notNull().default(0),
  sessionTimeSec: integer("session_time_sec").notNull().default(0),
  /** RADIUS Acct-Terminate-Cause text, e.g. "User-Request", "Lost-Carrier", "Admin-Reset", "Session-Timeout". Null while status=ACTIVE. */
  terminateCause: text("terminate_cause"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastInterimAt: timestamp("last_interim_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  routerSessionIdx: uniqueIndex("radius_accounting_router_session_idx").on(t.routerId, t.acctSessionId),
  customerIdx: index("radius_accounting_customer_idx").on(t.customerId, t.startedAt),
  tenantStatusIdx: index("radius_accounting_tenant_status_idx").on(t.tenantId, t.status),
}));

export type RadiusServerConfig = typeof radiusServerConfigTable.$inferSelect;
export type RadiusAuthEvent = typeof radiusAuthEventsTable.$inferSelect;
export type RadiusAccounting = typeof radiusAccountingTable.$inferSelect;
