import { customFetch } from "@workspace/api-client-react";

const jsonPatch = <T>(url: string, body: unknown) => customFetch<T>(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const jsonPut = <T>(url: string, body: unknown) => customFetch<T>(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const jsonPost = <T>(url: string, body?: unknown) => customFetch<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

// --- Tenant (General / Tenant Information / Branding) ---
export interface TenantDto {
  id: string; name: string; slug: string; logoUrl: string | null; isActive: boolean; onboardingCompletedAt: string | null;
  /** Numeric-as-string, same reason every other numeric() column in this app is typed as a string on the wire. */
  loyaltyPointsPerKes: string; loyaltyRedemptionValueKes: string;
}
export const getTenant = () => customFetch<{ tenant: TenantDto }>("/api/tenant");
export const updateTenant = (patch: { name?: string; logoUrl?: string; loyaltyPointsPerKes?: number; loyaltyRedemptionValueKes?: number }) => jsonPatch<{ tenant: TenantDto }>("/api/tenant", patch);

// --- M-Pesa (Payment Methods) ---
export interface MpesaSettingsDto {
  accountType: "PAYBILL" | "TILL"; shortcode: string | null; environment: string; callbackUrl: string | null;
  hasConsumerKey: boolean; hasConsumerSecret: boolean; hasPasskey: boolean; isEnabled: boolean; configured: boolean; updatedAt?: string;
}
export const getMpesaSettings = () => customFetch<MpesaSettingsDto>("/api/settings/mpesa");
export const updateMpesaSettings = (patch: {
  accountType?: "PAYBILL" | "TILL"; shortcode?: string; environment?: "sandbox" | "production"; callbackUrl?: string;
  consumerKey?: string; consumerSecret?: string; passkey?: string; isEnabled?: boolean;
}) => jsonPut<MpesaSettingsDto>("/api/settings/mpesa", patch);

// --- SMS (Notifications > SMS Gateway) ---
export interface SmsSettingsDto {
  provider: string; senderId: string | null; apiUrl: string | null;
  hasApiKey: boolean; hasApiSecret: boolean; isEnabled: boolean; configured: boolean; updatedAt?: string;
}
export const getSmsSettings = () => customFetch<SmsSettingsDto>("/api/settings/sms");
export const updateSmsSettings = (patch: { provider?: string; senderId?: string; apiUrl?: string; apiKey?: string; apiSecret?: string; isEnabled?: boolean }) => jsonPut<SmsSettingsDto>("/api/settings/sms", patch);
export const testSmsSettings = (phone: string) => jsonPost<{ success: boolean; error?: string; providerMessageId?: string }>("/api/settings/sms/test", { phone });

// --- System ---
export interface SystemInfoDto {
  environment: string; smsConfigured: boolean; mpesaEnvVarsConfigured: boolean; llmNarrativeConfigured: boolean;
  counts: { routers: number; activeSubscriptions: number; activeStaff: number }; serverTime: string;
}
export const getSystemInfo = () => customFetch<SystemInfoDto>("/api/settings/system");

// --- Loyalty overview (Loyalty Points / Wallet) ---
export interface LoyaltyOverviewDto {
  loyalty: { accountsWithBalance: number; outstandingPoints: number; lifetimeEarned: number };
  wallet: { accounts: number; outstandingBalanceKes: number };
}
export const getLoyaltyOverview = () => customFetch<LoyaltyOverviewDto>("/api/settings/loyalty-overview");
