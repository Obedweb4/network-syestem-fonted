import { pgTable, text, boolean, timestamp, uuid, pgEnum, integer } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";
import { customersTable } from "./customers";

export const notificationChannelEnum = pgEnum("notification_channel", ["SMS", "EMAIL", "WHATSAPP"]);
export const notificationStatusEnum = pgEnum("notification_status", ["QUEUED", "SENDING", "SENT", "DELIVERED", "FAILED"]);

export const notificationTemplatesTable = pgTable("notification_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  // Convention: `name` doubles as the event key looked up by the notification
  // service (e.g. "otp_login", "internet_activated", "expiry_reminder") — see
  // lib/notification-templates.ts DEFAULT_TEMPLATES for the full list. A
  // tenant only needs a row here to *override* the built-in default copy;
  // the app works without any rows in this table.
  name: text("name").notNull(),
  channel: notificationChannelEnum("channel").notNull(),
  subject: text("subject"),
  bodyTemplate: text("body_template").notNull(),
  variables: text("variables").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationLogsTable = pgTable("notification_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => notificationTemplatesTable.id, { onDelete: "set null" }),
  customerId: uuid("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  channel: notificationChannelEnum("channel").notNull(),
  recipient: text("recipient").notNull(),
  // The actual rendered message text. Previously missing — without it a
  // retry sweep would have nothing to resend, and a "notification log" was
  // really just a receipt with no content.
  body: text("body"),
  /** Convention explained on notificationTemplatesTable.name — which event this was. Nullable for the older ad-hoc /notifications/send path. */
  eventKey: text("event_key"),
  status: notificationStatusEnum("status").notNull().default("QUEUED"),
  errorMessage: text("error_message"),
  providerMessageId: text("provider_message_id"),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-tenant SMS provider configuration, editable from the admin dashboard
 * (Settings > Notifications > SMS). Falls back to the deployment-wide
 * TEXIN_* env vars when a tenant hasn't configured their own — see
 * lib/sms/index.ts. Secrets are encrypted at rest with the same
 * AES-256-GCM helper already used for router credentials
 * (lib/provisioning-credentials.ts), keyed by PROVISIONING_CREDENTIAL_KEY —
 * intentionally not a new key, so there is exactly one secret-at-rest
 * mechanism to operate and rotate.
 */
export const tenantSmsSettingsTable = pgTable("tenant_sms_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenantsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("texin"),
  senderId: text("sender_id"),
  apiUrl: text("api_url"),
  apiKeyEncrypted: text("api_key_encrypted"),
  apiSecretEncrypted: text("api_secret_encrypted"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationTemplate = typeof notificationTemplatesTable.$inferSelect;
export type NotificationLog = typeof notificationLogsTable.$inferSelect;
export type TenantSmsSettings = typeof tenantSmsSettingsTable.$inferSelect;
