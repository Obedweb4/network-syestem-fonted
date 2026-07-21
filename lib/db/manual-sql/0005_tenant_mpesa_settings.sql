-- Per-tenant M-PESA (Daraja) credential configuration
-- (Settings > Payment Methods > M-Pesa Paybill/Till).
--
-- Same situation as the earlier manual-sql files: this repo applies schema
-- changes with `drizzle-kit push`, not tracked migrations. Run:
--   cd lib/db && DATABASE_URL=<your-db-url> pnpm push
-- This file is the hand-written equivalent for teams who want to review or
-- apply plain SQL instead. Additive only (one new table) — safe to run
-- against a live database with no downtime.

BEGIN;

CREATE TYPE "mpesa_account_type" AS ENUM ('PAYBILL', 'TILL');

-- Secrets are encrypted at rest with the same AES-256-GCM helper already
-- used for router credentials and the SMS gateway settings, keyed by
-- PROVISIONING_CREDENTIAL_KEY.
CREATE TABLE IF NOT EXISTS "tenant_mpesa_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  "account_type" "mpesa_account_type" NOT NULL DEFAULT 'PAYBILL',
  "shortcode" text,
  "environment" text NOT NULL DEFAULT 'sandbox',
  "consumer_key_encrypted" text,
  "consumer_secret_encrypted" text,
  "passkey_encrypted" text,
  "callback_url" text,
  "is_enabled" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- Verify:
--   \d tenant_mpesa_settings
