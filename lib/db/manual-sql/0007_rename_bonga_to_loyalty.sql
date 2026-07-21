-- Renames "Bonga Points" to "Loyalty Points" throughout the schema.
--
-- Product decision: this in-app points program was named after Safaricom's
-- own "Bonga Points" airtime rewards program, which was confusing (this is
-- a separate, PulseNet-operated points balance, not connected to Safaricom's
-- program in any way) and reads as an unintended trademark reference.
-- Renaming to the generic "Loyalty Points" everywhere: schema, API
-- responses, admin UI, customer portal.
--
-- Same situation as every other manual-sql file here: this repo applies
-- schema via `drizzle-kit push`. Run:
--   cd lib/db && DATABASE_URL=<your-db-url> pnpm push
-- This is the hand-written equivalent, for teams who'd rather run plain SQL.
--
-- Renames preserve all existing data — no drops, no data loss, safe to run
-- against a live database. Application code in this codebase has already
-- been updated to the new names, so deploy this migration together with
-- (not before) the corresponding application release, same as any rename
-- migration.
--
-- Not included: the underlying auto-generated constraint/index names
-- (e.g. a primary key literally named "bonga_accounts_pkey") are left as
-- history. They're internal Postgres implementation detail, never
-- referenced by application code, and PostgreSQL doesn't rename them
-- automatically when you rename the table/column they belong to — so
-- renaming them too means first checking actual current names with
-- `\d bonga_accounts` (they depend on the exact drizzle-kit version that
-- originally created them, so this file can't safely guess them). Purely
-- cosmetic if you want to do it; nothing functional depends on it.

BEGIN;

ALTER TABLE "bonga_accounts" RENAME TO "loyalty_accounts";
ALTER TABLE "bonga_transactions" RENAME TO "loyalty_transactions";
ALTER TABLE "loyalty_transactions" RENAME COLUMN "bonga_account_id" TO "loyalty_account_id";

ALTER TABLE "tenants" RENAME COLUMN "bonga_points_per_kes" TO "loyalty_points_per_kes";
ALTER TABLE "tenants" RENAME COLUMN "bonga_redemption_value_kes" TO "loyalty_redemption_value_kes";

-- The `payment_method` enum's BONGA value (points redeemed against an
-- invoice) — existing rows keep their value, just relabeled, same as every
-- other rename in this file.
ALTER TYPE "payment_method" RENAME VALUE 'BONGA' TO 'LOYALTY';

COMMIT;

-- Verify:
--   \d loyalty_accounts
--   \d loyalty_transactions
--   select loyalty_points_per_kes, loyalty_redemption_value_kes from tenants limit 1;
--   select enum_range(NULL::payment_method);
