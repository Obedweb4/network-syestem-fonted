import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  provisioningMappingsTable,
  subscriptionsTable,
  servicePlansTable,
  radiusAuthEventsTable,
  radiusServerConfigTable,
  routersTable,
} from "@workspace/db/schema";
import { decryptCredential } from "@workspace/crypto";
import {
  RadiusCode,
  Attr,
  MikrotikAttr,
  attrString,
  attrUint32,
  mikrotikAttr,
  decryptPapPassword,
  verifyChapPassword,
  encodeResponse,
  findAttr,
  attrToString,
  type DecodedPacket,
  type RawAttribute,
} from "./codec";
import type { ResolvedNas } from "./nas-resolver";

/** Machine-readable reasons persisted to radius_auth_events.reasonCode. */
export type AuthReasonCode =
  | "ok"
  | "unknown_user"
  | "bad_password"
  | "subscription_missing"
  | "subscription_suspended"
  | "subscription_expired"
  | "subscription_cancelled"
  | "provisioning_not_ready"
  | "malformed_request";

export interface AuthOutcome {
  /** Wire-ready Access-Accept or Access-Reject, already signed with the response authenticator. */
  responseBuffer: Buffer;
  accepted: boolean;
  reasonCode: AuthReasonCode;
}

/**
 * Handles one decoded Access-Request. Never throws for a business-logic
 * rejection (unknown user, expired subscription, ...) — those are normal
 * outcomes encoded as Access-Reject. Only genuinely malformed input short-
 * circuits early, and even that returns a reject rather than propagating,
 * since a UDP server has no one to hand an exception to.
 */
export async function handleAccessRequest(packet: DecodedPacket, nas: ResolvedNas): Promise<AuthOutcome> {
  const username = attrToString(findAttr(packet.attributes, Attr.USER_NAME));
  if (!username) {
    return reject(packet, nas.secret, "malformed_request", "Access-Request missing User-Name");
  }

  const callingStationId = attrToString(findAttr(packet.attributes, Attr.CALLING_STATION_ID));

  // The subscriber's router-side account IS the provisioning_mappings row —
  // RADIUS never gets its own copy of the credential (see schema/radius.ts).
  const [mapping] = await db
    .select()
    .from(provisioningMappingsTable)
    .where(and(eq(provisioningMappingsTable.routerUsername, username), eq(provisioningMappingsTable.tenantId, nas.tenantId)))
    .limit(1);

  if (!mapping) {
    return reject(packet, nas.secret, "unknown_user", `No provisioning mapping for "${username}"`, { username, nas });
  }

  if (mapping.status !== "SUCCESS" && mapping.status !== "SUSPENDED") {
    return reject(packet, nas.secret, "provisioning_not_ready", `Mapping status is ${mapping.status}`, {
      username, nas, customerId: mapping.customerId, subscriptionId: mapping.subscriptionId,
    });
  }

  if (!mapping.pppoePasswordEncrypted) {
    return reject(packet, nas.secret, "provisioning_not_ready", "No credential set on this account", {
      username, nas, customerId: mapping.customerId, subscriptionId: mapping.subscriptionId,
    });
  }

  let plaintextPassword: string;
  try {
    plaintextPassword = decryptCredential(mapping.pppoePasswordEncrypted);
  } catch {
    return reject(packet, nas.secret, "provisioning_not_ready", "Stored credential is unreadable", {
      username, nas, customerId: mapping.customerId, subscriptionId: mapping.subscriptionId,
    });
  }

  const passwordOk = checkPassword(packet, nas.secret, plaintextPassword);
  if (!passwordOk) {
    return reject(packet, nas.secret, "bad_password", "Password/CHAP-Response did not match", {
      username, nas, customerId: mapping.customerId, subscriptionId: mapping.subscriptionId,
    });
  }

  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.id, mapping.subscriptionId))
    .limit(1);

  if (!subscription) {
    return reject(packet, nas.secret, "subscription_missing", "provisioning_mappings row has no subscription", {
      username, nas, customerId: mapping.customerId,
    });
  }

  const subReject = subscriptionRejectionReason(subscription.status);
  if (subReject) {
    return reject(packet, nas.secret, subReject, `Subscription status is ${subscription.status}`, {
      username, nas, customerId: mapping.customerId, subscriptionId: subscription.id,
    });
  }

  const [plan] = await db.select().from(servicePlansTable).where(eq(servicePlansTable.id, subscription.planId)).limit(1);
  const [cfg] = await db.select().from(radiusServerConfigTable).where(eq(radiusServerConfigTable.tenantId, nas.tenantId)).limit(1);

  const attributes = buildAcceptAttributes({ plan, cfg, router: nas.router, mapping, callingStationId });

  await logAuthEvent({
    tenantId: nas.tenantId, routerId: nas.router.id, customerId: mapping.customerId, subscriptionId: subscription.id,
    username, nasIpAddress: nas.router.ipAddress, callingStationId, result: "ACCESS_ACCEPT", reasonCode: "ok", reasonMessage: null,
  });
  await touchNasContact(nas.router.id);

  return {
    accepted: true,
    reasonCode: "ok",
    responseBuffer: encodeResponse({
      code: RadiusCode.ACCESS_ACCEPT,
      identifier: packet.identifier,
      requestAuthenticator: packet.authenticator,
      secret: nas.secret,
      attributes,
    }),
  };
}

function subscriptionRejectionReason(status: string): AuthReasonCode | null {
  switch (status) {
    case "ACTIVE":
      return null;
    case "SUSPENDED":
    case "OVERDUE":
      return "subscription_suspended";
    case "EXPIRED":
      return "subscription_expired";
    case "CANCELLED":
      return "subscription_cancelled";
    default:
      return "subscription_suspended";
  }
}

/** PAP (User-Password) or CHAP (CHAP-Password + optional CHAP-Challenge), per RFC 2865 §5.2/§2.2. */
function checkPassword(packet: DecodedPacket, secret: string, plaintextPassword: string): boolean {
  const chapAttr = findAttr(packet.attributes, Attr.CHAP_PASSWORD);
  if (chapAttr) {
    const challengeAttr = findAttr(packet.attributes, Attr.CHAP_CHALLENGE);
    const challenge = challengeAttr ? challengeAttr.value : packet.authenticator;
    return verifyChapPassword(chapAttr.value, challenge, plaintextPassword);
  }
  const papAttr = findAttr(packet.attributes, Attr.USER_PASSWORD);
  if (papAttr) {
    const decrypted = decryptPapPassword(papAttr.value, secret, packet.authenticator);
    return decrypted === plaintextPassword;
  }
  return false; // neither PAP nor CHAP present — nothing to verify against
}

function buildAcceptAttributes(opts: {
  plan: { speedUpKbps: number | null; speedDownKbps: number | null; sessionTimeoutSec: number | null; idleTimeoutSec: number | null; framedPool: string | null; addressList: string | null; vlanId: number | null } | undefined;
  cfg: { defaultSessionTimeoutSec: number | null; defaultIdleTimeoutSec: number | null; defaultFramedPool: string | null } | undefined;
  router: { ipAddress: string };
  mapping: { mikrotikProfileName: string | null; boundMacAddress: string | null };
  callingStationId: string | undefined;
}): RawAttribute[] {
  const { plan, cfg, mapping } = opts;
  const attrs: RawAttribute[] = [];

  const sessionTimeout = plan?.sessionTimeoutSec ?? cfg?.defaultSessionTimeoutSec;
  const idleTimeout = plan?.idleTimeoutSec ?? cfg?.defaultIdleTimeoutSec;
  const framedPool = plan?.framedPool ?? cfg?.defaultFramedPool;

  if (sessionTimeout) attrs.push(attrUint32(Attr.SESSION_TIMEOUT, sessionTimeout));
  if (idleTimeout) attrs.push(attrUint32(Attr.IDLE_TIMEOUT, idleTimeout));
  if (framedPool) attrs.push(attrString(Attr.FRAMED_POOL, framedPool));
  if (plan?.addressList) attrs.push(mikrotikAttr(MikrotikAttr.ADDRESS_LIST, plan.addressList));
  if (mapping.mikrotikProfileName) attrs.push(attrString(Attr.FILTER_ID, mapping.mikrotikProfileName));

  // Mikrotik-Rate-Limit VSA: "rx-rate/tx-rate" in bps, from the plan's kbps columns.
  // RouterOS convention is upload-then-download from the *client's* perspective on
  // this attribute; PulseNet models speed as up/down from the subscriber's view too.
  if (plan?.speedUpKbps && plan?.speedDownKbps) {
    const rate = `${plan.speedUpKbps * 1000}/${plan.speedDownKbps * 1000}`;
    attrs.push(mikrotikAttr(MikrotikAttr.RATE_LIMIT, rate));
  }

  if (plan?.vlanId) attrs.push(mikrotikAttr(MikrotikAttr.GROUP, String(plan.vlanId)));

  return attrs;
}

function reject(
  packet: DecodedPacket,
  secret: string,
  reasonCode: AuthReasonCode,
  reasonMessage: string,
  logCtx?: { username: string; nas: ResolvedNas; customerId?: string; subscriptionId?: string },
): AuthOutcome {
  if (logCtx) {
    void logAuthEvent({
      tenantId: logCtx.nas.tenantId,
      routerId: logCtx.nas.router.id,
      customerId: logCtx.customerId ?? null,
      subscriptionId: logCtx.subscriptionId ?? null,
      username: logCtx.username,
      nasIpAddress: logCtx.nas.router.ipAddress,
      callingStationId: attrToString(findAttr(packet.attributes, Attr.CALLING_STATION_ID)) ?? null,
      result: "ACCESS_REJECT",
      reasonCode,
      reasonMessage,
    });
  }
  const attrs: RawAttribute[] = [attrString(Attr.REPLY_MESSAGE, reasonMessage)];
  return {
    accepted: false,
    reasonCode,
    responseBuffer: encodeResponse({
      code: RadiusCode.ACCESS_REJECT,
      identifier: packet.identifier,
      requestAuthenticator: packet.authenticator,
      secret,
      attributes: attrs,
    }),
  };
}

async function logAuthEvent(row: {
  tenantId: string; routerId: string | null; customerId: string | null; subscriptionId: string | null;
  username: string; nasIpAddress: string | null; callingStationId: string | null | undefined;
  result: "ACCESS_ACCEPT" | "ACCESS_REJECT"; reasonCode: string; reasonMessage: string | null;
}): Promise<void> {
  try {
    await db.insert(radiusAuthEventsTable).values({
      tenantId: row.tenantId, routerId: row.routerId, customerId: row.customerId, subscriptionId: row.subscriptionId,
      username: row.username, nasIpAddress: row.nasIpAddress, callingStationId: row.callingStationId ?? null,
      result: row.result, reasonCode: row.reasonCode, reasonMessage: row.reasonMessage,
    });
  } catch {
    // Audit logging must never take down the AAA path — a DB hiccup here
    // should not turn into a customer's Wi-Fi not working.
  }
}

async function touchNasContact(routerId: string): Promise<void> {
  try {
    await db.update(routersTable).set({ lastRadiusContactAt: new Date() }).where(eq(routersTable.id, routerId));
  } catch {
    // best-effort — see logAuthEvent
  }
}
