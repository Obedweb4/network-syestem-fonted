import { customFetch } from "@workspace/api-client-react";

const jsonPost = <T>(url: string, body?: unknown) =>
  customFetch<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

export interface EngineOutcomeDto {
  success: boolean;
  subscriptionId: string;
  error?: string;
  errorCode?: string;
  password?: string;
}

export interface ProvisioningMappingDto {
  id: string;
  routerId: string;
  routerUsername: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCESS" | "FAILED" | "SUSPENDED" | "DEPROVISIONED";
  mikrotikProfileName: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  lastProvisioningAttempt: string | null;
  lastProvisioningError: string | null;
  provisionedAt: string | null;
  deprovisionedAt: string | null;
}

export interface StatusHistoryEntryDto {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string;
  actorUserId: string | null;
  createdAt: string;
}

export function fetchProvisioningStatus(subscriptionId: string) {
  return customFetch<{ mapping: ProvisioningMappingDto | null; history: StatusHistoryEntryDto[] }>(`/api/subscriptions/${subscriptionId}/provisioning`);
}

export function provisionSubscription(subscriptionId: string) {
  return jsonPost<EngineOutcomeDto>(`/api/subscriptions/${subscriptionId}/provision`);
}

export function suspendSubscription(subscriptionId: string, reason?: string) {
  return jsonPost<EngineOutcomeDto>(`/api/subscriptions/${subscriptionId}/suspend`, { reason });
}

export function reactivateSubscription(subscriptionId: string) {
  return jsonPost<EngineOutcomeDto>(`/api/subscriptions/${subscriptionId}/reactivate`);
}

export function cancelSubscription(subscriptionId: string, reason?: string) {
  return jsonPost<EngineOutcomeDto>(`/api/subscriptions/${subscriptionId}/cancel`, { reason });
}

export function reprovisionSubscription(subscriptionId: string, changes: { newPlanId?: string; newRouterId?: string }) {
  return jsonPost<EngineOutcomeDto>(`/api/subscriptions/${subscriptionId}/reprovision`, changes);
}

export function resetSubscriberPassword(subscriptionId: string) {
  return jsonPost<EngineOutcomeDto>(`/api/subscriptions/${subscriptionId}/reset-password`);
}

export function bulkSubscriptionAction(subscriptionIds: string[], action: "provision" | "suspend" | "reactivate" | "deprovision", reason?: string) {
  return jsonPost<{ results: EngineOutcomeDto[]; skipped: Array<{ subscriptionId: string; reason: string }>; summary: { total: number; succeeded: number; failed: number } }>(
    "/api/subscriptions/bulk-action", { subscriptionIds, action, reason },
  );
}

export interface LiveSessionDto {
  id: string;
  username: string;
  address?: string;
  uptime?: string;
}

export function fetchRouterSessions(routerId: string) {
  return customFetch<{ routerId: string; pppoe: LiveSessionDto[]; hotspot: LiveSessionDto[] }>(`/api/routers/${routerId}/sessions`);
}

export function disconnectSession(sessionId: string, routerId: string, type: "PPPOE" | "HOTSPOT") {
  return jsonPost<{ success: boolean; error?: string }>(`/api/sessions/${sessionId}/disconnect`, { routerId, type });
}

export function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string } } | undefined)?.data;
  return data?.error ?? fallback;
}
