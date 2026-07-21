-- AI NOC schema (lib/db/src/schema/noc.ts + routers.wanInterface).
-- Same situation as manual-sql/0001: this repo applies schema via
-- `drizzle-kit push`, not tracked migrations. Run:
--   cd lib/db && DATABASE_URL=<your-db-url> pnpm push
-- This file is the hand-written equivalent for teams who want to review or
-- apply plain SQL instead. Fully additive — new tables/enums, and one new
-- nullable column on an existing table. No data loss, no rewrites of
-- existing rows, safe to run against a live database.

BEGIN;

ALTER TABLE "routers" ADD COLUMN "wan_interface" text;

CREATE TYPE "router_health_status" AS ENUM ('ONLINE', 'DEGRADED', 'OFFLINE');

CREATE TABLE "router_health_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "router_id" uuid NOT NULL REFERENCES "routers"("id") ON DELETE CASCADE,
  "captured_at" timestamptz NOT NULL DEFAULT now(),
  "status" "router_health_status" NOT NULL,
  "cpu_load_percent" integer,
  "memory_used_percent" integer,
  "uptime_seconds" integer,
  "pppoe_active_count" integer,
  "hotspot_active_count" integer,
  "rx_bps" numeric(14, 0),
  "tx_bps" numeric(14, 0),
  "error_message" text
);
CREATE INDEX "router_health_snapshots_router_time_idx" ON "router_health_snapshots" ("router_id", "captured_at");
CREATE INDEX "router_health_snapshots_tenant_time_idx" ON "router_health_snapshots" ("tenant_id", "captured_at");

CREATE TYPE "noc_incident_category" AS ENUM (
  'ROUTER_OFFLINE', 'ROUTER_FLAPPING', 'SITE_OUTAGE', 'RESOURCE_EXHAUSTION',
  'BANDWIDTH_ANOMALY', 'SESSION_ANOMALY', 'CONGESTION_RISK',
  'PROVISIONING_FAILURE_SPIKE', 'PAYMENT_FAILURE_SPIKE'
);
CREATE TYPE "noc_incident_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'AUTO_RESOLVED');

CREATE TABLE "noc_incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "router_id" uuid REFERENCES "routers"("id") ON DELETE CASCADE,
  "site_id" uuid REFERENCES "sites"("id") ON DELETE SET NULL,
  "category" "noc_incident_category" NOT NULL,
  "severity" "alert_severity" NOT NULL,
  "status" "noc_incident_status" NOT NULL DEFAULT 'OPEN',
  "title" text NOT NULL,
  "detection_summary" text NOT NULL,
  "root_cause_narrative" text,
  "customers_impacted_count" integer NOT NULL DEFAULT 0,
  "signal_snapshot" jsonb,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "acknowledged_at" timestamptz,
  "acknowledged_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamptz,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "auto_resolved" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "noc_incidents_tenant_status_idx" ON "noc_incidents" ("tenant_id", "status");
CREATE INDEX "noc_incidents_router_idx" ON "noc_incidents" ("router_id");

CREATE TYPE "noc_incident_event_kind" AS ENUM (
  'DETECTED', 'SIGNAL_ADDED', 'SEVERITY_CHANGED', 'RECOMMENDATION_GENERATED',
  'ACTION_EXECUTED', 'ACKNOWLEDGED', 'RESOLVED', 'REOPENED', 'NOTE', 'REPORT_GENERATED'
);

CREATE TABLE "noc_incident_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "incident_id" uuid NOT NULL REFERENCES "noc_incidents"("id") ON DELETE CASCADE,
  "kind" "noc_incident_event_kind" NOT NULL,
  "message" text NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_label" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "noc_incident_events_incident_time_idx" ON "noc_incident_events" ("incident_id", "created_at");

CREATE TYPE "noc_action_type" AS ENUM (
  'RESTART_MONITORING', 'RETRY_PROVISIONING', 'DISCONNECT_ORPHAN_SESSION',
  'REACTIVATE_SUBSCRIPTION', 'SUSPEND_SUBSCRIPTION', 'REPROVISION_ROUTER', 'NONE_INFO_ONLY'
);
CREATE TYPE "noc_risk_level" AS ENUM ('SAFE', 'REQUIRES_APPROVAL', 'INFO_ONLY');
CREATE TYPE "noc_recommendation_status" AS ENUM ('PENDING', 'AUTO_EXECUTED', 'APPROVED', 'EXECUTED', 'REJECTED', 'FAILED', 'EXPIRED');

CREATE TABLE "noc_recommendations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "incident_id" uuid REFERENCES "noc_incidents"("id") ON DELETE CASCADE,
  "router_id" uuid REFERENCES "routers"("id") ON DELETE CASCADE,
  "subscription_id" uuid REFERENCES "subscriptions"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "rationale" text NOT NULL,
  "action_type" "noc_action_type" NOT NULL,
  "action_params" jsonb,
  "risk_level" "noc_risk_level" NOT NULL,
  "status" "noc_recommendation_status" NOT NULL DEFAULT 'PENDING',
  "confidence" integer NOT NULL DEFAULT 60,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "decided_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamptz,
  "executed_at" timestamptz,
  "execution_result" jsonb,
  "execution_error" text
);
CREATE INDEX "noc_recommendations_tenant_status_idx" ON "noc_recommendations" ("tenant_id", "status");

CREATE TYPE "noc_forecast_metric" AS ENUM ('BANDWIDTH', 'SESSIONS');

CREATE TABLE "noc_capacity_forecasts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "router_id" uuid NOT NULL REFERENCES "routers"("id") ON DELETE CASCADE,
  "metric" "noc_forecast_metric" NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "current_utilization_percent" numeric(6, 2) NOT NULL,
  "trend_slope_per_day" numeric(8, 4),
  "projected_breach_at" timestamptz,
  "breach_threshold_percent" integer NOT NULL DEFAULT 85,
  "horizon_days" integer NOT NULL DEFAULT 30,
  "sample_days" integer NOT NULL DEFAULT 0
);
CREATE INDEX "noc_capacity_forecasts_router_metric_idx" ON "noc_capacity_forecasts" ("router_id", "metric");

CREATE TABLE "noc_settings" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "auto_remediation_enabled" boolean NOT NULL DEFAULT false,
  "llm_narrative_enabled" boolean NOT NULL DEFAULT true,
  "poll_interval_seconds" integer NOT NULL DEFAULT 60,
  "analysis_interval_seconds" integer NOT NULL DEFAULT 180,
  "snapshot_retention_days" integer NOT NULL DEFAULT 90,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Also needed (from the earlier hotspot MAC-binding change) if not already applied:
ALTER TABLE "stk_push_requests" ADD COLUMN IF NOT EXISTS "mac_address" text;

COMMIT;

-- Verify:
--   \dt noc_*
--   \d routers
