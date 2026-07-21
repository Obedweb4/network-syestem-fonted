import { customFetch } from "@workspace/api-client-react";

const jsonPost = <T>(url: string, body?: unknown) =>
  customFetch<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

const jsonPut = <T>(url: string, body?: unknown) =>
  customFetch<T>(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

// ---------------------------------------------------------------------------
// Types (hand-declared to mirror routes/noc.ts's JSON shapes exactly)
// ---------------------------------------------------------------------------

export type RouterStatus = "ONLINE" | "DEGRADED" | "OFFLINE";

export interface NocOverviewDto {
  routers: { total: number; online: number; degraded: number; offline: number };
  sessions: { pppoeActive: number; hotspotActive: number };
  incidents: { open: number; critical: number };
  recommendations: { pending: number };
  subscriptions: { active: number; suspended: number; overdue: number; expired: number };
  payments: { paidLast30d: number; failedLast30d: number };
  provisioning: { succeededLastHour: number; failedLastHour: number };
  llmNarrativeAvailable: boolean;
}

export interface NocRouterDto {
  id: string; name: string; ipAddress: string; siteId: string | null; isActive: boolean;
  status: RouterStatus; lastSeenAt: string | null;
  cpuLoadPercent: number | null; memoryUsedPercent: number | null; uptimeSeconds: number | null;
  pppoeActiveCount: number | null; hotspotActiveCount: number | null;
  rxBps: number | null; txBps: number | null; errorMessage: string | null;
}

export interface RouterSnapshotDto {
  id: string; capturedAt: string; status: RouterStatus;
  cpuLoadPercent: number | null; memoryUsedPercent: number | null;
  pppoeActiveCount: number | null; hotspotActiveCount: number | null;
  rxBps: string | null; txBps: string | null; errorMessage: string | null;
}

export interface NocLogEntryDto { routerId: string; routerName: string; time: unknown; topics: unknown; message: unknown }

export type IncidentSeverity = "INFO" | "WARN" | "CRITICAL";
export type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "AUTO_RESOLVED";

export interface NocIncidentDto {
  id: string; tenantId: string; routerId: string | null; siteId: string | null;
  category: string; severity: IncidentSeverity; status: IncidentStatus;
  title: string; detectionSummary: string; rootCauseNarrative: string | null;
  customersImpactedCount: number; signalSnapshot: Record<string, unknown> | null;
  openedAt: string; acknowledgedAt: string | null; resolvedAt: string | null; autoResolved: boolean;
}

export interface NocIncidentEventDto {
  id: string; kind: string; message: string; actorUserId: string | null; actorLabel: string | null; createdAt: string;
}

export type ActionType = "RESTART_MONITORING" | "RETRY_PROVISIONING" | "DISCONNECT_ORPHAN_SESSION" | "REACTIVATE_SUBSCRIPTION" | "SUSPEND_SUBSCRIPTION" | "REPROVISION_ROUTER" | "NONE_INFO_ONLY";
export type RiskLevel = "SAFE" | "REQUIRES_APPROVAL" | "INFO_ONLY";
export type RecommendationStatus = "PENDING" | "AUTO_EXECUTED" | "APPROVED" | "EXECUTED" | "REJECTED" | "FAILED" | "EXPIRED";

export interface NocRecommendationDto {
  id: string; incidentId: string | null; routerId: string | null; subscriptionId: string | null;
  title: string; rationale: string; actionType: ActionType; riskLevel: RiskLevel; status: RecommendationStatus;
  confidence: number; createdAt: string; executionError: string | null;
}

export interface NocForecastDto {
  id: string; router_id: string; metric: "BANDWIDTH" | "SESSIONS"; generated_at: string;
  current_utilization_percent: string; trend_slope_per_day: string | null;
  projected_breach_at: string | null; breach_threshold_percent: number; sample_days: number;
}

export interface NocSettingsDto {
  tenantId: string; autoRemediationEnabled: boolean; llmNarrativeEnabled: boolean;
  pollIntervalSeconds: number; analysisIntervalSeconds: number; snapshotRetentionDays: number;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export const getNocOverview = () => customFetch<NocOverviewDto>("/api/noc/overview");
export const listNocRouters = () => customFetch<{ routers: NocRouterDto[] }>("/api/noc/routers");
export const getRouterHistory = (routerId: string, hours = 24) => customFetch<{ router: { id: string; name: string }; snapshots: RouterSnapshotDto[] }>(`/api/noc/routers/${routerId}/history?hours=${hours}`);
export const getNocLogs = () => customFetch<{ logs: NocLogEntryDto[] }>("/api/noc/logs");

export const listIncidents = (status?: IncidentStatus | "ALL") => customFetch<{ incidents: NocIncidentDto[] }>(`/api/noc/incidents${status ? `?status=${status}` : ""}`);
export const getIncident = (id: string) => customFetch<{ incident: NocIncidentDto; events: NocIncidentEventDto[]; recommendations: NocRecommendationDto[] }>(`/api/noc/incidents/${id}`);
export const acknowledgeIncident = (id: string) => jsonPost<{ success: boolean }>(`/api/noc/incidents/${id}/acknowledge`);
export const resolveIncident = (id: string, note?: string) => jsonPost<{ success: boolean }>(`/api/noc/incidents/${id}/resolve`, { note });
export const getIncidentReport = (id: string) => customFetch<{ markdown: string }>(`/api/noc/incidents/${id}/report`);

export const listRecommendations = (status?: RecommendationStatus) => customFetch<{ recommendations: NocRecommendationDto[] }>(`/api/noc/recommendations${status ? `?status=${status}` : ""}`);
export const approveRecommendation = (id: string) => jsonPost<{ success: boolean; result?: unknown; error?: string }>(`/api/noc/recommendations/${id}/approve`);
export const rejectRecommendation = (id: string) => jsonPost<{ success: boolean; error?: string }>(`/api/noc/recommendations/${id}/reject`);

export const listForecasts = () => customFetch<{ forecasts: NocForecastDto[] }>("/api/noc/forecasts");

export const getNocSettings = () => customFetch<{ settings: NocSettingsDto }>("/api/noc/settings");
export const updateNocSettings = (patch: Partial<Omit<NocSettingsDto, "tenantId">>) => jsonPut<{ settings: NocSettingsDto }>("/api/noc/settings", patch);
