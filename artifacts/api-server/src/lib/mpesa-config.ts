import { db } from "@workspace/db";
import { tenantMpesaSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { decryptCredential } from "./provisioning-credentials";
import type { MpesaCredentials } from "./mpesa";

/**
 * Resolves which M-PESA (Daraja) credentials a tenant's STK push should use:
 * an enabled tenant_mpesa_settings row (dashboard-configured, Settings >
 * Payment Methods > M-Pesa Paybill/Till) takes priority over the
 * deployment-wide MPESA_* env vars. Returns undefined (not a throw) when
 * neither is fully configured, so the caller can decide how to respond
 * (initiateStkPush's own env fallback will then raise MpesaConfigError with
 * a clear message, exactly as it did before per-tenant config existed).
 */
export async function resolveMpesaCredentials(tenantId: string): Promise<MpesaCredentials | undefined> {
  const [settings] = await db.select().from(tenantMpesaSettingsTable).where(eq(tenantMpesaSettingsTable.tenantId, tenantId)).limit(1);
  if (!settings?.isEnabled || !settings.shortcode || !settings.consumerKeyEncrypted || !settings.consumerSecretEncrypted || !settings.passkeyEncrypted) {
    return undefined; // not configured for this tenant — caller falls back to env vars
  }

  try {
    return {
      consumerKey: decryptCredential(settings.consumerKeyEncrypted),
      consumerSecret: decryptCredential(settings.consumerSecretEncrypted),
      shortcode: settings.shortcode,
      passkey: decryptCredential(settings.passkeyEncrypted),
      callbackUrl: settings.callbackUrl || requiredEnvCallback(),
      environment: settings.environment === "production" ? "production" : "sandbox",
    };
  } catch {
    // Decryption failure (e.g. PROVISIONING_CREDENTIAL_KEY rotated) must
    // never crash a payment attempt — fall back to env vars instead.
    return undefined;
  }
}

function requiredEnvCallback(): string {
  const url = process.env.MPESA_CALLBACK_URL;
  if (!url) throw new Error("Tenant has no callbackUrl configured and MPESA_CALLBACK_URL is not set as a fallback.");
  return url;
}
