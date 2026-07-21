-- Schema changes for MAC/IP-bound Hotspot access (credential-free provisioning).
--
-- This repo applies schema changes with `drizzle-kit push` (see
-- lib/db/drizzle.config.ts and lib/db/package.json's "push" script) rather
-- than tracked generated migrations, so there is no `drizzle/` migrations
-- folder to add a file to. The normal way to apply these changes is:
--
--   cd lib/db && DATABASE_URL=<your-db-url> pnpm push
--
-- This file is a hand-written equivalent of that diff, provided for teams
-- who want to review/run plain SQL (e.g. via a CI migration step, or a
-- staging DB without direct `push` access) instead. Every change here is
-- additive (new nullable columns / a column with a default) — nothing here
-- drops, renames, or rewrites existing data, so it's safe to run against a
-- live database with no downtime.

BEGIN;

CREATE TYPE "ip_binding_status" AS ENUM (
  'NOT_APPLICABLE',
  'PENDING',
  'BOUND',
  'SUSPENDED',
  'FAILED',
  'REMOVED'
);

ALTER TABLE "provisioning_mappings"
  ADD COLUMN "bound_mac_address" text,
  ADD COLUMN "ip_binding_status" "ip_binding_status" NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "ip_binding_router_entry_id" text,
  ADD COLUMN "ip_binding_attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "ip_binding_next_retry_at" timestamptz,
  ADD COLUMN "ip_binding_last_error" text,
  ADD COLUMN "ip_binding_last_error_code" text,
  ADD COLUMN "ip_binding_bound_at" timestamptz;

ALTER TABLE "stk_push_requests"
  ADD COLUMN "mac_address" text;

COMMIT;

-- Verify:
--   \d provisioning_mappings
--   \d stk_push_requests
--   SELECT enum_range(NULL::ip_binding_status);
