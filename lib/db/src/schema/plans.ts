import { pgTable, text, boolean, timestamp, uuid, numeric, integer, pgEnum } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";

export const planTypeEnum = pgEnum("plan_type", ["HOTSPOT", "PPPOE"]);

export const servicePlansTable = pgTable("service_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  type: planTypeEnum("type").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  durationDays: integer("duration_days").notNull(),
  dataLimitMb: integer("data_limit_mb"),
  speedUpKbps: integer("speed_up_kbps"),
  speedDownKbps: integer("speed_down_kbps"),
  validityHours: integer("validity_hours"),

  // --- RADIUS authorization attributes. Bandwidth is already covered by
  // speedUpKbps/speedDownKbps above (RADIUS just encodes those into a
  // Mikrotik-Rate-Limit reply attribute) — these are the additional
  // per-plan network attributes an Access-Accept can carry. All nullable:
  // an unset value falls back to the tenant's radius_server_config
  // defaults, then to RouterOS's own profile/NAS defaults. ---
  /** RADIUS Session-Timeout (seconds) — NAS force-disconnects the session after this long regardless of activity. */
  sessionTimeoutSec: integer("session_timeout_sec"),
  /** RADIUS Idle-Timeout (seconds) — NAS disconnects after this long with no traffic. */
  idleTimeoutSec: integer("idle_timeout_sec"),
  /** Sent as RADIUS Framed-Pool — the RouterOS IP pool name this plan's subscribers should be assigned an address from. */
  framedPool: text("framed_pool"),
  /** Sent as a Mikrotik-Address-List VSA — the RouterOS address-list this plan's subscribers should be added to (e.g. for firewall/QoS marking by plan tier). */
  addressList: text("address_list"),
  /** Sent as a Mikrotik-Group / Tunnel-Private-Group-Id VSA when the router uses VLANs to separate plan tiers. Null = no VLAN tagging. */
  vlanId: integer("vlan_id"),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ServicePlan = typeof servicePlansTable.$inferSelect;
