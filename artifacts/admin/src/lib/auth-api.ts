import { customFetch } from "@workspace/api-client-react";

export interface AuthUserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  roles: string[];
}

export interface LoginSuccess {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
  user: AuthUserDto;
}

export interface LoginTwoFactorChallenge {
  requires2FA: true;
  tempToken: string;
}

const jsonPost = <T>(url: string, body: unknown) =>
  customFetch<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function loginRequest(email: string, password: string) {
  return jsonPost<LoginSuccess | LoginTwoFactorChallenge>("/api/auth/login", { email, password });
}

export function verifyLoginTwoFactor(tempToken: string, code: string) {
  return jsonPost<LoginSuccess>("/api/auth/login/2fa", { tempToken, code });
}

export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  businessLocation: string;
  password: string;
  confirmPassword: string;
}

export function registerAccount(data: RegisterInput) {
  return jsonPost<{ message: string; pendingApproval: boolean; userId: string }>("/api/auth/register", data);
}

export function forgotPassword(email: string) {
  return jsonPost<{ message: string }>("/api/auth/forgot-password", { email });
}

export function resetPassword(token: string, password: string) {
  return jsonPost<{ message: string }>("/api/auth/reset-password", { token, password });
}

export interface PendingUserDto {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  businessLocation: string | null;
  createdAt: string;
}

export function fetchPendingUsers() {
  return customFetch<{ users: PendingUserDto[] }>("/api/auth/pending-users");
}

export function approveUser(userId: string, role: string) {
  return jsonPost<{ message: string }>("/api/auth/approve-user", { userId, role });
}

export function rejectUser(userId: string, reason?: string) {
  return jsonPost<{ message: string }>("/api/auth/reject-user", { userId, reason });
}

export interface SessionDto {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export function fetchSessions() {
  return customFetch<{ sessions: SessionDto[] }>("/api/auth/sessions");
}

export function revokeSession(id: string) {
  return jsonPost<{ success: boolean }>(`/api/auth/sessions/${id}/revoke`, {});
}

export function setup2FA() {
  return customFetch<{ secret: string; otpauthUrl: string }>("/api/auth/2fa/setup", { method: "POST" });
}

export function verify2FA(code: string) {
  return jsonPost<{ message: string }>("/api/auth/2fa/verify", { code });
}

export function disable2FA(password: string) {
  return jsonPost<{ message: string }>("/api/auth/2fa/disable", { password });
}

export interface TenantDto {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  onboardingCompletedAt: string | null;
}

export function fetchTenant() {
  return customFetch<{ tenant: TenantDto }>("/api/tenant");
}

export function updateTenant(data: { name?: string; logoUrl?: string }) {
  return customFetch<{ tenant: TenantDto }>("/api/tenant", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
}

export function completeOnboarding() {
  return customFetch<{ tenant: TenantDto }>("/api/tenant/onboarding/complete", { method: "POST" });
}

export function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string } } | undefined)?.data;
  return data?.error ?? fallback;
}

/** After a successful login, sends first-time owners to the setup wizard. */
export async function postLoginDestination(accessToken: string): Promise<string> {
  try {
    const { tenant } = await customFetch<{ tenant: TenantDto }>("/api/tenant", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return tenant.onboardingCompletedAt ? "/dashboard" : "/setup";
  } catch {
    return "/dashboard";
  }
}
