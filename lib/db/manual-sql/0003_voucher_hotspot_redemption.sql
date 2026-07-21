-- Schema changes for self-serve captive-portal voucher redemption
-- (POST /portal/vouchers/redeem) and its optional hotspot/site restriction.
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
-- (new nullable columns only) — nothing here drops, renames, or rewrites
-- existing data, so it's safe to run against a live database with no
-- downtime.

BEGIN;

ALTER TABLE "voucher_batches"
  ADD COLUMN "router_id" uuid REFERENCES "routers"("id") ON DELETE SET NULL,
  ADD COLUMN "site_id" uuid REFERENCES "sites"("id") ON DELETE SET NULL;

ALTER TABLE "vouchers"
  ADD COLUMN "redeemed_mac_address" text,
  ADD COLUMN "redeemed_ip_address" text,
  ADD COLUMN "redeemed_user_agent" text,
  ADD COLUMN "redeemed_router_id" uuid REFERENCES "routers"("id") ON DELETE SET NULL;

COMMIT;

-- Verify:
--   \d voucher_batches
--   \d vouchers
