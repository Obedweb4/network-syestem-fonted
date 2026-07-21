-- Schema changes for customer OTP login (POST /portal/auth/otp/request,
-- /portal/auth/otp/verify) and the templated SMS notification system
-- (lib/notify.ts, lib/notification-templates.ts, lib/sms/, and the
-- Settings > Notifications > SMS admin UI backed by routes/notifications.ts).
--
-- This repo applies schema changes with `drizzle-kit push` (see
-- lib/db/drizzle.config.ts and lib/db/package.json's "push" script) rather
-- than tracked generated migrations, so there is no `drizzle/` migrations
-- folder to add a file to. The normal way to apply these changes is:
--
--   cd lib/db && DATABASE_URL=<your-db-url> pnpm push
--
-- This file is a hand-written equivalent of that diff, provided for teams
-- who want to review/run plain SQL instead. Every change here is additive
-- (new table, new nullable columns only) — nothing here drops, renames, or
-- rewrites existing data, so it's safe to run against a live database with
-- no downtime.

BEGIN;

-- One-time codes for optional customer sign-in — see customers.ts schema
-- comment. Only the SHA-256 hash of the code is ever stored.
CREATE TABLE IF NOT EXISTS "customer_otp_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "attempts" smallint NOT NULL DEFAULT 0,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Per-tenant SMS provider configuration (Settings > Notifications > SMS).
-- Secrets are encrypted at rest with the same AES-256-GCM helper already
-- used for router credentials, keyed by PROVISIONING_CREDENTIAL_KEY.
CREATE TABLE IF NOT EXISTS "tenant_sms_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'texin',
  "sender_id" text,
  "api_url" text,
  "api_key_encrypted" text,
  "api_secret_encrypted" text,
  "is_enabled" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Guards the once-per-billing-period expiry-reminder SMS sweep
-- (services/expiry-enforcement.ts::sendExpiryReminders). Cleared on
-- renewal/refill so the next billing cycle gets its own reminder.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "expiry_reminder_sent_at" timestamptz;

-- notification_logs gains real content and delivery-retry tracking — a log
-- row used to be just a receipt with no message text, which left nothing
-- for a retry sweep to resend.
ALTER TABLE "notification_logs"
  ADD COLUMN IF NOT EXISTS "body" text,
  ADD COLUMN IF NOT EXISTS "event_key" text,
  ADD COLUMN IF NOT EXISTS "provider_message_id" text,
  ADD COLUMN IF NOT EXISTS "retry_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz;

-- "SENDING" is a new transient status between "QUEUED" and "SENT"/"FAILED",
-- covering the moment a provider call is actually in flight.
ALTER TYPE "notification_status" ADD VALUE IF NOT EXISTS 'SENDING';

COMMIT;

-- Verify:
--   \d customer_otp_codes
--   \d tenant_sms_settings
--   \d subscriptions
--   \d notification_logs
--   \dT+ notification_status
