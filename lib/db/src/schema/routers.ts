import { pgTable, text, boolean, timestamp, uuid, integer, pgEnum, bigint } from "drizzle-orm/pg-core";
import { tenantsTable, sitesTable } from "./platform";
import { customersTable } from "./customers";

export const alertSeverityEnum = pgEnum("alert_severity", ["INFO", "WARN", "CRITICAL"]);

export const routersTable = pgTable("routers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  ipAddress: text("ip_address").notNull(),
  apiPort: integer("api_port").notNull().default(8728),
  apiUsername: text("api_username").notNull(),
  apiSecret: text("api_secret").notNull(),
  model: text("model"),
  firmwareVersion: text("firmware_version"),
  /** Optional: pin which RouterOS interface represents this router's internet uplink (e.g. "ether1" or a PPPoE-out/VLAN interface). Used by the NOC collector to source bandwidth/congestion metrics. When unset, the collector auto-picks the busiest running non-loopback interface each poll — set this explicitly on routers with multiple WAN-like interfaces where auto-detection would be ambiguous. */
  wanInterface: text("wan_interface"),
  isActive: boolean("is_active").notNull().default(true),

  // --- RADIUS NAS settings. A router already *is* a NAS, so RADIUS just
  // adds columns here instead of a separate "nas_clients" table (see
  // schema/radius.ts header for the full reuse rationale). ---
  /** Enables `use-radius=yes` style auth for this router's PPP/Hotspot profiles. Off by default: RouterOS keeps using its local /ppp/secret and /ip/hotspot/user accounts (the existing provisioning flow) until an admin explicitly flips this on for a router that's been pointed at PulseNet's RADIUS server. */
  radiusEnabled: boolean("radius_enabled").notNull().default(false),
  /** AES-256-GCM ciphertext (lib/provisioning-credentials.ts) of this NAS's RADIUS shared secret. Null falls back to the tenant's radius_server_config.defaultSecretEncrypted. */
  radiusSecretEncrypted: text("radius_secret_encrypted"),
  /** Optional RADIUS NAS-Identifier override; defaults to the router's own `name` when unset. */
  radiusNasIdentifier: text("radius_nas_identifier"),
  radiusAuthPort: integer("radius_auth_port"),
  radiusAcctPort: integer("radius_acct_port"),
  /** Last time this NAS successfully sent an Access-Request or Accounting-Request — drives the "Synchronization status" admin view. */
  lastRadiusContactAt: timestamp("last_radius_contact_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const routerAlertsTable = pgTable("router_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  routerId: uuid("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(),
  severity: alertSeverityEnum("severity").notNull(),
  message: text("message").notNull(),
  isResolved: boolean("is_resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hotspotSessionsTable = pgTable("hotspot_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  routerId: uuid("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  macAddress: text("mac_address").notNull(),
  ipAddress: text("ip_address"),
  bytesIn: bigint("bytes_in", { mode: "number" }).notNull().default(0),
  bytesOut: bigint("bytes_out", { mode: "number" }).notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export type Router = typeof routersTable.$inferSelect;
export type RouterAlert = typeof routerAlertsTable.$inferSelect;
export type HotspotSession = typeof hotspotSessionsTable.$inferSelect
