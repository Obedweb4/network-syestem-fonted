-- Centralized RADIUS (AAA) support.
--
-- Same situation as every other manual-sql file here: this repo applies
-- schema via `drizzle-kit push`. Run:
--   cd lib/db && DATABASE_URL=<your-db-url> pnpm push
-- This is the hand-written equivalent, for reference/DBA review before
-- pushing to a production database.
--
-- Additive only:
--   - two new columns on `routers` (RADIUS NAS settings)
--   - six new columns on `service_plans` (RADIUS authorization attributes)
--   - three new tables (`radius_server_config`, `radius_auth_events`,
--     `radius_accounting`)
-- No existing column is altered or dropped, and `routers.radius_enabled`
-- defaults to false, so applying this changes no runtime behavior for any
-- existing deployment until a tenant explicitly turns RADIUS on for a NAS
-- from Admin > RADIUS.

BEGIN;

CREATE TYPE "radius_packet_result" AS ENUM ('ACCESS_ACCEPT', 'ACCESS_REJECT');
CREATE TYPE "radius_session_type" AS ENUM ('PPPOE', 'HOTSPOT');
CREATE TYPE "radius_session_status" AS ENUM ('ACTIVE', 'STOPPED');

ALTER TABLE "routers"
  ADD COLUMN IF NOT EXISTS "radius_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "radius_secret_encrypted" text,
  ADD COLUMN IF NOT EXISTS "radius_nas_identifier" text,
  ADD COLUMN IF NOT EXISTS "radius_auth_port" integer,
  ADD COLUMN IF NOT EXISTS "radius_acct_port" integer,
  ADD COLUMN IF NOT EXISTS "last_radius_contact_at" timestamptz;

ALTER TABLE "service_plans"
  ADD COLUMN IF NOT EXISTS "session_timeout_sec" integer,
  ADD COLUMN IF NOT EXISTS "idle_timeout_sec" integer,
  ADD COLUMN IF NOT EXISTS "framed_pool" text,
  ADD COLUMN IF NOT EXISTS "address_list" text,
  ADD COLUMN IF NOT EXISTS "vlan_id" integer;

CREATE TABLE IF NOT EXISTS "radius_server_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "auth_port" integer NOT NULL DEFAULT 1812,
  "acct_port" integer NOT NULL DEFAULT 1813,
  "default_secret_encrypted" text,
  "default_session_timeout_sec" integer,
  "default_idle_timeout_sec" integer,
  "default_framed_pool" text,
  "interim_update_interval_sec" integer NOT NULL DEFAULT 300,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "radius_auth_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "router_id" uuid REFERENCES "routers"("id") ON DELETE SET NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "subscription_id" uuid REFERENCES "subscriptions"("id") ON DELETE SET NULL,
  "username" text NOT NULL,
  "nas_ip_address" text,
  "calling_station_id" text,
  "result" radius_packet_result NOT NULL,
  "reason_code" text NOT NULL,
  "reason_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "radius_auth_events_tenant_created_idx" ON "radius_auth_events" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "radius_auth_events_result_idx" ON "radius_auth_events" ("tenant_id", "result", "created_at");

CREATE TABLE IF NOT EXISTS "radius_accounting" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "router_id" uuid NOT NULL REFERENCES "routers"("id") ON DELETE CASCADE,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "subscription_id" uuid REFERENCES "subscriptions"("id") ON DELETE SET NULL,
  "session_type" radius_session_type NOT NULL,
  "status" radius_session_status NOT NULL DEFAULT 'ACTIVE',
  "username" text NOT NULL,
  "acct_session_id" text NOT NULL,
  "nas_ip_address" text,
  "nas_port_id" text,
  "calling_station_id" text,
  "framed_ip_address" text,
  "bytes_in" bigint NOT NULL DEFAULT 0,
  "bytes_out" bigint NOT NULL DEFAULT 0,
  "packets_in" bigint NOT NULL DEFAULT 0,
  "packets_out" bigint NOT NULL DEFAULT 0,
  "session_time_sec" integer NOT NULL DEFAULT 0,
  "terminate_cause" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "last_interim_at" timestamptz,
  "ended_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "radius_accounting_router_session_idx" ON "radius_accounting" ("router_id", "acct_session_id");
CREATE INDEX IF NOT EXISTS "radius_accounting_customer_idx" ON "radius_accounting" ("customer_id", "started_at");
CREATE INDEX IF NOT EXISTS "radius_accounting_tenant_status_idx" ON "radius_accounting" ("tenant_id", "status");

COMMIT;

-- Verify:
--   \d routers
--   \d service_plans
--   select * from radius_server_config;
