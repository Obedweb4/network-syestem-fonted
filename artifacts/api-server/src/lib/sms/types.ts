/**
 * The notification service (lib/notify.ts) only ever talks to this
 * interface — never to a specific gateway's SDK/HTTP shape directly. Adding
 * a second provider later means implementing this interface once, not
 * touching every place an SMS gets sent.
 */
export interface SmsSendParams {
  to: string;
  message: string;
  /** Overrides the provider's configured default sender ID for this one send, if the provider supports it. */
  senderId?: string;
}

export interface SmsSendResult {
  success: boolean;
  /** The provider's own message/transaction id, stored on notification_logs.providerMessageId for later delivery-status reconciliation. */
  providerMessageId?: string;
  error?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(params: SmsSendParams): Promise<SmsSendResult>;
}
