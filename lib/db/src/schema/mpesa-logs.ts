import { pgTable, text, timestamp, uuid, pgEnum, jsonb, boolean } from "drizzle-orm/pg-core";
import { tenantsTable } from "./platform";
import { stkPushRequestsTable } from "./stk-push";

export const mpesaLogTypeEnum = pgEnum("mpesa_log_type", [
  "AUTH_TOKEN",
  "STK_PUSH_REQUEST",
  "STK_PUSH_RESPONSE",
  "CALLBACK_RECEIVED",
  "CALLBACK_REJECTED",
  "CALLBACK_PROCESSED",
]);

/**
 * Append-only raw audit trail of every Daraja API interaction: outbound
 * auth-token requests, outbound STK push requests/responses, and every
 * inbound callback exactly as Safaricom sent it (including callbacks that
 * fail validation or arrive twice). Distinct from `stk_push_requests`, which
 * holds the current business state of a single payment attempt — this table
 * is never updated, only inserted into, so it stays a trustworthy record
 * even if a callback is rejected or a payment fails.
 *
 * `payload` never contains MPESA_CONSUMER_SECRET/MPESA_PASSKEY — only the
 * request/response bodies exchanged with Daraja.
 */
export const mpesaTransactionLogsTable = pgTable("mpesa_transaction_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  stkPushRequestId: uuid("stk_push_request_id").references(() => stkPushRequestsTable.id, { onDelete: "set null" }),
  type: mpesaLogTypeEnum("type").notNull(),
  checkoutRequestId: text("checkout_request_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MpesaTransactionLog = typeof mpesaTransactionLogsTable.$inferSelect;

export const mpesaAccountTypeEnum = pgEnum("mpesa_account_type", ["PAYBILL", "TILL"]);

/**
 * Per-tenant Daraja (M-PESA) app credentials, editable from the admin
 * dashboard (Settings > Payment Methods > M-Pesa Paybill/Till). Falls back
 * to the deployment-wide MPESA_* env vars when a tenant hasn't configured
 * their own — see lib/mpesa-config.ts. Secrets are encrypted at rest with
 * the same AES-256-GCM helper already used for router credentials and the
 * SMS gateway (lib/provisioning-credentials.ts), keyed by
 * PROVISIONING_CREDENTIAL_KEY — intentionally the same key, so there remains
 * exactly one secret-at-rest mechanism to operate and rotate.
 */
export const tenantMpesaSettingsTable = pgTable("tenant_mpesa_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenantsTable.id, { onDelete: "cascade" }),
  accountType: mpesaAccountTypeEnum("account_type").notNull().default("PAYBILL"),
  shortcode: text("shortcode"),
  environment: text("environment").notNull().default("sandbox"),
  consumerKeyEncrypted: text("consumer_key_encrypted"),
  consumerSecretEncrypted: text("consumer_secret_encrypted"),
  passkeyEncrypted: text("passkey_encrypted"),
  /** Overrides the deployment-wide MPESA_CALLBACK_URL when set — needed if a tenant's Daraja app is registered with its own callback URL. */
  callbackUrl: text("callback_url"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantMpesaSettings = typeof tenantMpesaSettingsTable.$inferSelect;
