import { db } from "@workspace/db";
import { notificationTemplatesTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Every event the notification service currently knows how to send.
 * `notificationTemplatesTable.name` uses these same strings when a tenant
 * wants to override the default copy — see that table's schema comment.
 */
export const NOTIFICATION_EVENTS = [
  "welcome",
  "otp_login",
  "internet_activated",
  "suspension",
  "reactivation",
  "subscription_cancelled",
  "plan_changed",
  "router_changed",
  "password_reset_router",
  "expiry_reminder",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Built-in copy used whenever a tenant hasn't configured their own template for this event — the app sends sensible SMS out of the box. */
const DEFAULT_TEMPLATES: Record<NotificationEvent, string> = {
  welcome: "Welcome to {{tenantName}}, {{firstName}}! Buy a package anytime to get connected — no account needed.",
  otp_login: "Your {{tenantName}} verification code is {{code}}. It expires in {{expiryMinutes}} minutes. Don't share this code with anyone.",
  internet_activated: "Your {{planName}} package is now active. Enjoy your internet!",
  suspension: "Your {{tenantName}} access has been suspended: {{reason}}. Contact support to restore access.",
  reactivation: "Your {{tenantName}} access has been restored. Enjoy your internet!",
  subscription_cancelled: "Your {{tenantName}} subscription was cancelled: {{reason}}.",
  plan_changed: "Your {{tenantName}} plan has changed to {{planName}}.",
  router_changed: "Your {{tenantName}} service has moved to {{routerName}}. Your plan and billing are unaffected.",
  password_reset_router: "Your {{tenantName}} router access password has been reset. Contact support if you didn't request this.",
  expiry_reminder: "Your {{planName}} package expires on {{expiryDate}}. Renew now to avoid interruption.",
};

/**
 * Resolves the SMS body template for an event: a tenant's own active
 * notification_templates row (looked up by name=event, channel=SMS) if they
 * have one, otherwise the built-in default above. Never throws — an event
 * key with no default and no tenant override just returns null, and the
 * caller treats that as "nothing to send" rather than crashing.
 */
export async function resolveTemplate(tenantId: string, event: NotificationEvent): Promise<string | null> {
  const [tenantTemplate] = await db.select({ bodyTemplate: notificationTemplatesTable.bodyTemplate })
    .from(notificationTemplatesTable)
    .where(and(
      eq(notificationTemplatesTable.tenantId, tenantId),
      eq(notificationTemplatesTable.name, event),
      eq(notificationTemplatesTable.channel, "SMS"),
      eq(notificationTemplatesTable.isActive, true),
    ))
    .limit(1);
  return tenantTemplate?.bodyTemplate ?? DEFAULT_TEMPLATES[event] ?? null;
}

/** Replaces {{key}} placeholders. Unmatched placeholders are left as-is (visible) rather than silently dropped, so a missing variable is obvious instead of producing a garbled message. */
export function renderTemplate(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}
