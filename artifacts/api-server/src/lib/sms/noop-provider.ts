import type { SmsProvider, SmsSendParams, SmsSendResult } from "./types";
import { logger } from "../logger";

/**
 * Used whenever no SMS gateway is configured yet (no TEXIN_* env vars and no
 * enabled tenant_sms_settings row) — same "don't block the app, don't lie
 * about delivery" rule this project already applies to M-PESA
 * (MpesaConfigError) and forgot-password (dev-only console log, never a
 * fake SENT). A notification queued through this provider stays QUEUED with
 * a clear errorMessage instead of ever being marked SENT.
 */
export class NoopSmsProvider implements SmsProvider {
  readonly name = "noop";

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    logger.warn({ to: params.to }, "SMS not sent: no SMS provider is configured for this tenant/deployment yet");
    return { success: false, error: "No SMS provider configured. Set TEXIN_* env vars or configure it in Settings > Notifications > SMS." };
  }
}
