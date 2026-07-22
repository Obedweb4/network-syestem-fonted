import type { SmsProvider, SmsSendParams, SmsSendResult } from "./types";
import { logger } from "../logger";

export interface TexinConfig {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  senderId?: string;
}

/**
 * IMPORTANT — verify before production use:
 * Texin's own API reference sits behind their client dashboard login
 * (texin.co.ke), so the exact request/response field names below could not
 * be confirmed from public docs while building this. The shape here follows
 * the common pattern used by most Kenyan bulk-SMS gateways (api key +
 * sender/shortcode + destination + message, JSON POST, a per-recipient
 * status code back) — the same "sandbox now, confirm before go-live"
 * posture this project already takes with M-PESA. Everything provider-
 * specific is isolated in buildRequestBody()/parseResponse() below so that
 * once you're logged into the real Texin dashboard and have their actual
 * API reference, updating the contract is a two-function edit — nothing
 * else in the codebase (lib/notify.ts, the retry sweep, the routes) needs
 * to change, because they only ever talk to the SmsProvider interface.
 */
export class TexinSmsProvider implements SmsProvider {
  readonly name = "texin";
  private config: TexinConfig;

  constructor(config: TexinConfig) {
    this.config = config;
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const { apiUrl, apiKey, apiSecret, senderId } = this.config;
    if (!apiUrl || !apiKey || !apiSecret) {
      return { success: false, error: "Texin is not fully configured (missing apiUrl/apiKey/apiSecret)." };
    }

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.buildRequestBody(params, senderId)),
      });
    } catch (err) {
      logger.error({ err, to: params.to }, "Texin SMS request failed to reach the gateway");
      return { success: false, error: err instanceof Error ? err.message : "Could not reach the Texin SMS gateway" };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      logger.error({ status: response.status, body, to: params.to }, "Texin SMS gateway returned an error response");
      return { success: false, error: `Texin gateway error (HTTP ${response.status})` };
    }

    return this.parseResponse(body);
  }

  /** ADJUST to match your Texin account's actual field names once confirmed. */
  private buildRequestBody(params: SmsSendParams, senderId?: string): Record<string, unknown> {
    return {
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      senderId: params.senderId ?? senderId ?? undefined,
      to: params.to,
      message: params.message,
    };
  }

  /** ADJUST alongside buildRequestBody once Texin's actual response shape is confirmed. */
  private parseResponse(body: unknown): SmsSendResult {
    if (!body || typeof body !== "object") {
      return { success: false, error: "Texin gateway returned an unexpected response body" };
    }
    const b = body as Record<string, unknown>;
    const ok = b.status === "success" || b.success === true || b.status === "SUCCESS";
    const messageId = typeof b.messageId === "string" ? b.messageId : typeof b.id === "string" ? b.id : undefined;
    if (!ok) {
      const error = typeof b.message === "string" ? b.message : typeof b.error === "string" ? b.error : "Texin reported the message was not sent";
      return { success: false, error };
    }
    return { success: true, providerMessageId: messageId };
  }
}
