import { pgTable, text, boolean, timestamp, uuid, numeric } from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  /**
   * Loyalty Points earn rate: points awarded per 1 KES paid, applied to every
   * successful subscription payment/renewal (see
   * services/subscription-lifecycle.ts::renewOrCreateSubscription, the
   * single place both M-PESA payment and voucher redemption funnel through).
   * "0" disables earning entirely without needing a separate feature flag —
   * a tenant that hasn't set this yet simply awards nothing, which was
   * already the previous (accidental) behavior, so this default changes
   * nothing for existing deployments until a tenant opts in from Settings.
   */
  loyaltyPointsPerKes: numeric("loyalty_points_per_kes", { precision: 8, scale: 4 }).notNull().default("0"),
  /** KES value of one point when a customer redeems (Settings > Loyalty Points). */
  loyaltyRedemptionValueKes: numeric("loyalty_redemption_value_kes", { precision: 8, scale: 4 }).notNull().default("1"),
  isActive: boolean("is_active").notNull().default(true),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sitesTable = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;
export type Site = typeof sitesTable.$inferSelect;
