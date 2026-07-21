import { pgTable, text, timestamp, uuid, integer, numeric, boolean, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { tenantsTable, sitesTable } from "./platform";
import { routersTable, alertSeverityEnum } from "./routers";
import { subscriptionsTable } from "./subscriptions";
import { usersTable } from "./users";

/**
 * PulseNet AI NOC (Network Operations Center)
 * ─────────────────────────────────────────────
 * This file is the data layer for the AI-powered NOC: a scheduled collector
 * (services/noc-collector.ts) samples every active router on an interval and
 * writes a row to `router_health_snapshots`; the analysis engine
 * (services/noc-analysis.ts) reads that history to detect faults, anomalies,
 * congestion trends and correlated outages, opening/updating rows in
 * `noc_incidents` with a running `noc_incident_events` timeline; and the
 * recommendation/action layer (services/noc-actions.ts) proposes or executes
 * a narrow, explicitly-allowlisted set of remediations, tracked in
 * `noc_recommendations`.
 *
 * Deliberately NOT duplicated here: `router_alerts` (routers.ts) keeps its
 * existing single owner (provisioning-engine.ts's raiseAlert) and existing
 * consumers (GET /routers/:id/alerts, /dashboard/ai-analysis) completely
 * unchanged — the NOC analysis engine only *reads* it as one more signal
 * source when correlating a router's incident history. This avoids two
 * different tables racing to describe the same event.
 */

// ---------------------------------------------------------------------------
// Time-series: router health snapshots
// ---------------------------------------------------------------------------

export const routerHealthStatusEnum = pgEnum("router_health_status", ["ONLINE", "DEGRADED", "OFFLINE"]);

export const routerHealthSnapshotsTable = pgTable("router_health_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  routerId: uuid("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  status: routerHealthStatusEnum("status").notNull(),
  cpuLoadPercent: integer("cpu_load_percent"),
  memoryUsedPercent: integer("memory_used_percent"),
  uptimeSeconds: integer("uptime_seconds"),
  pppoeActiveCount: integer("pppoe_active_count"),
  hotspotActiveCount: integer("hotspot_active_count"),
  /** Bits/sec inferred from the delta between this snapshot's and the previous snapshot's interface byte counters — null on a router's first-ever sample, or when the previous sample was too long ago to trust (router was offline in between). */
  rxBps: numeric("rx_bps", { precision: 14, scale: 0 }),
  txBps: numeric("tx_bps", { precision: 14, scale: 0 }),
  /** Present only when status is OFFLINE/DEGRADED because of a poll failure — the raw connect/command error, for RCA. */
  errorMessage: text("error_message"),
}, (t) => [
  index("router_health_snapshots_router_time_idx").on(t.routerId, t.capturedAt),
  index("router_health_snapshots_tenant_time_idx").on(t.tenantId, t.capturedAt),
]);

export type RouterHealthSnapshot = typeof routerHealthSnapshotsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Incidents + timeline
// ---------------------------------------------------------------------------

export const incidentCategoryEnum = pgEnum("noc_incident_category", [
  "ROUTER_OFFLINE",
  "ROUTER_FLAPPING",
  "SITE_OUTAGE",
  "RESOURCE_EXHAUSTION", // sustained high CPU/memory
  "BANDWIDTH_ANOMALY", // statistical deviation from baseline
  "SESSION_ANOMALY", // PPPoE/Hotspot session-count deviation from baseline
  "CONGESTION_RISK", // sold/observed capacity trending toward saturation
  "PROVISIONING_FAILURE_SPIKE",
  "PAYMENT_FAILURE_SPIKE",
]);

export const incidentStatusEnum = pgEnum("noc_incident_status", ["OPEN", "ACKNOWLEDGED", "RESOLVED", "AUTO_RESOLVED"]);

export const nocIncidentsTable = pgTable("noc_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  /** Null for a tenant-wide signal (e.g. a payment-failure spike not tied to one router). */
  routerId: uuid("router_id").references(() => routersTable.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
  category: incidentCategoryEnum("category").notNull(),
  severity: alertSeverityEnum("severity").notNull(),
  status: incidentStatusEnum("status").notNull().default("OPEN"),
  title: text("title").notNull(),
  /** Always present, deterministic, written by the rule engine — a human-readable NOC can trust this exists even when the LLM is unavailable or unconfigured. */
  detectionSummary: text("detection_summary").notNull(),
  /** LLM-synthesized root-cause narrative. Null until generated (or forever, if no ANTHROPIC_API_KEY is configured) — every consumer must treat this as optional. */
  rootCauseNarrative: text("root_cause_narrative"),
  /** How many distinct customers had a provisioned/active subscription on the affected router(s) when this incident opened — computed once at detection time, not live, so the number a resolved incident reports doesn't drift. */
  customersImpactedCount: integer("customers_impacted_count").notNull().default(0),
  /** The structured signals (snapshots, correlated alerts, audit-log rates, etc.) this incident was opened/updated from — the ground truth the narrative and recommendations were built on, kept for audit/replay. */
  signalSnapshot: jsonb("signal_snapshot").$type<Record<string, unknown>>(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  /** True when the underlying condition cleared on its own (e.g. router came back online) rather than a human marking it resolved. */
  autoResolved: boolean("auto_resolved").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("noc_incidents_tenant_status_idx").on(t.tenantId, t.status),
  index("noc_incidents_router_idx").on(t.routerId),
]);

export type NocIncident = typeof nocIncidentsTable.$inferSelect;

export const incidentEventKindEnum = pgEnum("noc_incident_event_kind", [
  "DETECTED", "SIGNAL_ADDED", "SEVERITY_CHANGED", "RECOMMENDATION_GENERATED",
  "ACTION_EXECUTED", "ACKNOWLEDGED", "RESOLVED", "REOPENED", "NOTE", "REPORT_GENERATED",
]);

/** Append-only activity feed for one incident — this is what the NOC's incident detail timeline renders. */
export const nocIncidentEventsTable = pgTable("noc_incident_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  incidentId: uuid("incident_id").notNull().references(() => nocIncidentsTable.id, { onDelete: "cascade" }),
  kind: incidentEventKindEnum("kind").notNull(),
  message: text("message").notNull(),
  /** Set when a human staff member is the actor; null for the collector/analysis engine or AI auto-remediation (see actorLabel). */
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** Free-text label for non-human actors, e.g. "AI NOC" or "Monitoring Collector" — kept separate from actorUserId so the UI can always show *something* for who/what did this without a join. */
  actorLabel: text("actor_label"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("noc_incident_events_incident_time_idx").on(t.incidentId, t.createdAt),
]);

export type NocIncidentEvent = typeof nocIncidentEventsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Recommendations (the "recommend or execute safe actions" layer)
// ---------------------------------------------------------------------------

/**
 * Fixed, closed set of actions the NOC is allowed to reason about. This enum
 * IS the allowlist boundary at the schema level — services/noc-actions.ts's
 * executor switches on exactly these values and nothing else ever reaches a
 * router or the provisioning engine, regardless of what an LLM narrative
 * suggests in free text.
 */
export const nocActionTypeEnum = pgEnum("noc_action_type", [
  "RESTART_MONITORING", // reset this router's collector backoff, poll it immediately — no customer impact
  "RETRY_PROVISIONING", // re-run the (already idempotent, already-retried) provisioning engine for one subscription, now instead of waiting for its own backoff
  "DISCONNECT_ORPHAN_SESSION", // drop a live router session whose backing subscription is EXPIRED/CANCELLED/SUSPENDED in billing — correcting a drift, not a judgment call
  "REACTIVATE_SUBSCRIPTION", // re-enable a subscription's existing router account
  "SUSPEND_SUBSCRIPTION", // disable a subscription's router account
  "REPROVISION_ROUTER", // move a subscription to a different router
  "NONE_INFO_ONLY", // no action exists / is safe — recommendation is advisory only (e.g. a capacity-upgrade suggestion)
]);

export const nocRiskLevelEnum = pgEnum("noc_risk_level", ["SAFE", "REQUIRES_APPROVAL", "INFO_ONLY"]);

export const nocRecommendationStatusEnum = pgEnum("noc_recommendation_status", [
  "PENDING", "AUTO_EXECUTED", "APPROVED", "EXECUTED", "REJECTED", "FAILED", "EXPIRED",
]);

export const nocRecommendationsTable = pgTable("noc_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  /** Null for a standalone recommendation not tied to an open incident (e.g. a capacity forecast's upgrade suggestion). */
  incidentId: uuid("incident_id").references(() => nocIncidentsTable.id, { onDelete: "cascade" }),
  routerId: uuid("router_id").references(() => routersTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  actionType: nocActionTypeEnum("action_type").notNull(),
  /** Parameters the executor passes to the underlying function — shape depends on actionType (e.g. {sessionId, routerId, type} for DISCONNECT_ORPHAN_SESSION). Never free-form code, only data for a pre-defined handler keyed on actionType. */
  actionParams: jsonb("action_params").$type<Record<string, unknown>>(),
  /**
   * Assigned by server-side rules in noc-analysis.ts based on `actionType`
   * ALONE — never taken from LLM output. This is what makes "AI recommends
   * or executes safe actions" safe: the model can describe and justify an
   * action, but it does not get a vote on whether that action is safe to
   * run without a human.
   */
  riskLevel: nocRiskLevelEnum("risk_level").notNull(),
  status: nocRecommendationStatusEnum("status").notNull().default("PENDING"),
  /** 0-100, informational only — never used to decide executability. */
  confidence: integer("confidence").notNull().default(60),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedByUserId: uuid("decided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  executionResult: jsonb("execution_result").$type<Record<string, unknown>>(),
  executionError: text("execution_error"),
}, (t) => [
  index("noc_recommendations_tenant_status_idx").on(t.tenantId, t.status),
]);

export type NocRecommendation = typeof nocRecommendationsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Capacity forecasting
// ---------------------------------------------------------------------------

export const forecastMetricEnum = pgEnum("noc_forecast_metric", ["BANDWIDTH", "SESSIONS"]);

export const nocCapacityForecastsTable = pgTable("noc_capacity_forecasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  routerId: uuid("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  metric: forecastMetricEnum("metric").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  /** 0-100+. For BANDWIDTH this is observed peak vs. sold capacity (sum of active plan speeds provisioned on this router); can exceed 100 (oversold). For SESSIONS it's current active count vs. the trailing-30-day peak. */
  currentUtilizationPercent: numeric("current_utilization_percent", { precision: 6, scale: 2 }).notNull(),
  /** Least-squares slope of daily peak utilization, in percentage points/day — the honest basis for the projection (simple, explainable trend extrapolation, not a black-box model). */
  trendSlopePerDay: numeric("trend_slope_per_day", { precision: 8, scale: 4 }),
  /** Null when the trend is flat/declining (no breach projected) or there isn't enough history yet to fit a trend. */
  projectedBreachAt: timestamp("projected_breach_at", { withTimezone: true }),
  breachThresholdPercent: integer("breach_threshold_percent").notNull().default(85),
  horizonDays: integer("horizon_days").notNull().default(30),
  /** How many days of history the regression was actually fit on — surfaced so the UI can flag a forecast built on thin data as low-confidence. */
  sampleDays: integer("sample_days").notNull().default(0),
}, (t) => [
  index("noc_capacity_forecasts_router_metric_idx").on(t.routerId, t.metric),
]);

export type NocCapacityForecast = typeof nocCapacityForecastsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Per-tenant NOC configuration
// ---------------------------------------------------------------------------

export const nocSettingsTable = pgTable("noc_settings", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenantsTable.id, { onDelete: "cascade" }),
  /** Master switch for SAFE-tier auto-execution. Defaults OFF: this product's existing AI Network Analyst is documented as read-only-by-design (see AI_ANALYST_ROLE.md / PROJECT_GUIDE.md — "not an autonomous router controller... existing staff tools execute changes explicitly"), so the NOC ships conservatively — every recommendation, including SAFE-tier ones, sits PENDING for a human to click "Run now" until a tenant explicitly enables this. Turning it on does not change the allowlist itself, only whether SAFE items are allowed to fire unattended. */
  autoRemediationEnabled: boolean("auto_remediation_enabled").notNull().default(false),
  /** Ask the configured LLM to write incident narratives/reports. When off (or no API key is configured), incidents and reports still work — they just use the deterministic, rule-based summary instead of prose. */
  llmNarrativeEnabled: boolean("llm_narrative_enabled").notNull().default(true),
  pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(60),
  analysisIntervalSeconds: integer("analysis_interval_seconds").notNull().default(180),
  snapshotRetentionDays: integer("snapshot_retention_days").notNull().default(90),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NocSettings = typeof nocSettingsTable.$inferSelect;
