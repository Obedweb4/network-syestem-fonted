import type { Request } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";

export interface AuditEventInput {
  tenantId?: string | null;
  userId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
}

/** Best-effort audit logging: never throws into the caller's request flow. */
export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      tenantId: event.tenantId ?? null,
      userId: event.userId ?? null,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
      ipAddress: event.req ? clientIp(event.req) : undefined,
      userAgent: event.req?.headers["user-agent"],
    });
  } catch (err) {
    // Audit logging must never break the request it's observing.
    console.error("Failed to record audit event", event.action, err);
  }
}

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0]!.trim();
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** Common action names, kept as constants so log queries/filters stay consistent. */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: "auth.login.success",
  LOGIN_FAILURE: "auth.login.failure",
  LOGIN_LOCKED: "auth.login.locked_out",
  LOGOUT: "auth.logout",
  TOKEN_REFRESH: "auth.token.refresh",
  REGISTER: "auth.register",
  SIGNUP: "auth.signup",
  PASSWORD_RESET_REQUESTED: "auth.password_reset.requested",
  PASSWORD_RESET_COMPLETED: "auth.password_reset.completed",
  TWO_FACTOR_ENABLED: "auth.2fa.enabled",
  TWO_FACTOR_DISABLED: "auth.2fa.disabled",
  TWO_FACTOR_CHALLENGE_FAILED: "auth.2fa.challenge_failed",
  SESSION_REVOKED: "auth.session.revoked",
  USER_APPROVED: "auth.user.approved",
  USER_REJECTED: "auth.user.rejected",
  CUSTOMER_OTP_REQUESTED: "customer_auth.otp.requested",
  CUSTOMER_OTP_VERIFIED: "customer_auth.otp.verified",
  CUSTOMER_OTP_FAILED: "customer_auth.otp.failed",
  CUSTOMER_LOGOUT: "customer_auth.logout",
  CUSTOMER_LOYALTY_REDEEMED: "customer.loyalty.redeemed",
} as const;
