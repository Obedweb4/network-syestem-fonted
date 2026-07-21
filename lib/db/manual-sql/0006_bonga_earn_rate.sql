-- Bonga Points earn-rate / redemption-value configuration
-- (Settings > Bonga Points), plus the manual admin adjustment endpoint's
-- transaction types.
--
-- Same situation as every other manual-sql file here: this repo applies
-- schema via `drizzle-kit push`. Run:
--   cd lib/db && DATABASE_URL=<your-db-url> pnpm push
-- This is the hand-written equivalent. Additive only (two new columns with
-- safe defaults) — safe to run against a live database with no downtime.
--
-- Context: before this, `bonga_accounts` existed and could be viewed and
-- redeemed from, but nothing anywhere ever credited a point — the earn
-- side of the feature was simply missing. `bonga_points_per_kes` defaults
-- to 0 (earning off) so applying this migration changes no behavior for
-- an existing deployment until a tenant explicitly sets a rate > 0 from
-- Settings > Bonga Points.

BEGIN;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "bonga_points_per_kes" numeric(8, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bonga_redemption_value_kes" numeric(8, 4) NOT NULL DEFAULT 1;

COMMIT;

-- Verify:
--   \d tenants
--   select id, name, bonga_points_per_kes, bonga_redemption_value_kes from tenants;
