import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiusAccountingTable, provisioningMappingsTable, routersTable } from "@workspace/db/schema";
import {
  RadiusCode,
  Attr,
  AcctStatusType,
  encodeResponse,
  findAttr,
  attrToString,
  attrToUint32,
  type DecodedPacket,
} from "./codec";
import type { ResolvedNas } from "./nas-resolver";

export interface AcctOutcome {
  responseBuffer: Buffer;
  handled: boolean;
  reason?: string;
}

/**
 * Handles one decoded Accounting-Request. Unlike auth, accounting always
 * gets an Accounting-Response back if the packet parses at all — RFC 2866
 * has no reject concept, and a NAS that doesn't get ack'd will just retransmit
 * forever. Anything we can't make sense of (unknown session, missing
 * customer) is logged and acked anyway.
 */
export async function handleAccountingRequest(packet: DecodedPacket, nas: ResolvedNas): Promise<AcctOutcome> {
  const statusType = attrToUint32(findAttr(packet.attributes, Attr.ACCT_STATUS_TYPE));
  const acctSessionId = attrToString(findAttr(packet.attributes, Attr.ACCT_SESSION_ID));
  const username = attrToString(findAttr(packet.attributes, Attr.USER_NAME)) ?? "unknown";

  const ack = (): AcctOutcome["responseBuffer"] =>
    encodeResponse({
      code: RadiusCode.ACCOUNTING_RESPONSE,
      identifier: packet.identifier,
      requestAuthenticator: packet.authenticator,
      secret: nas.secret,
      attributes: [],
    });

  if (!acctSessionId || statusType === undefined) {
    return { responseBuffer: ack(), handled: false, reason: "malformed_request" };
  }

  const callingStationId = attrToString(findAttr(packet.attributes, Attr.CALLING_STATION_ID));
  const framedIp = attrToString(findAttr(packet.attributes, Attr.FRAMED_IP_ADDRESS));
  // Attr.NAS_PORT (5) is RFC 2865's numeric physical/virtual port attribute —
  // there's no separate NAS-Port-Id string attribute in this codec's Attr
  // set, so stringify the numeric one for the nasPortId text column.
  const nasPortNum = attrToUint32(findAttr(packet.attributes, Attr.NAS_PORT));
  const nasPortId = nasPortNum !== undefined ? String(nasPortNum) : undefined;
  const bytesIn = attrToUint32(findAttr(packet.attributes, Attr.ACCT_INPUT_OCTETS)) ?? 0;
  const bytesOut = attrToUint32(findAttr(packet.attributes, Attr.ACCT_OUTPUT_OCTETS)) ?? 0;
  const packetsIn = attrToUint32(findAttr(packet.attributes, Attr.ACCT_INPUT_PACKETS)) ?? 0;
  const packetsOut = attrToUint32(findAttr(packet.attributes, Attr.ACCT_OUTPUT_PACKETS)) ?? 0;
  const sessionTime = attrToUint32(findAttr(packet.attributes, Attr.ACCT_SESSION_TIME)) ?? 0;
  const terminateCauseCode = attrToUint32(findAttr(packet.attributes, Attr.ACCT_TERMINATE_CAUSE));

  void touchNasContact(nas.router.id);

  try {
    switch (statusType) {
      case AcctStatusType.START:
        await handleStart({ nas, username, acctSessionId, callingStationId, framedIp, nasPortId });
        break;
      case AcctStatusType.INTERIM_UPDATE:
        await handleInterim({ nas, acctSessionId, bytesIn, bytesOut, packetsIn, packetsOut, sessionTime, framedIp });
        break;
      case AcctStatusType.STOP:
        await handleStop({ nas, acctSessionId, bytesIn, bytesOut, packetsIn, packetsOut, sessionTime, terminateCauseCode });
        break;
      default:
        // ACCOUNTING_ON / ACCOUNTING_OFF (NAS reboot markers) and anything
        // else we don't model per-session — ack and move on.
        return { responseBuffer: ack(), handled: false, reason: `unhandled_status_type_${statusType}` };
    }
  } catch {
    // Never let a DB error keep a NAS retransmitting an accounting packet
    // forever — ack it and rely on the next Interim-Update/Stop to
    // reconcile state.
    return { responseBuffer: ack(), handled: false, reason: "db_error" };
  }

  return { responseBuffer: ack(), handled: true };
}

async function handleStart(opts: {
  nas: ResolvedNas; username: string; acctSessionId: string;
  callingStationId: string | undefined; framedIp: string | undefined; nasPortId: string | undefined;
}): Promise<void> {
  const { nas } = opts;
  const [mapping] = await db
    .select()
    .from(provisioningMappingsTable)
    .where(and(eq(provisioningMappingsTable.routerUsername, opts.username), eq(provisioningMappingsTable.tenantId, nas.tenantId)))
    .limit(1);

  const sessionType = nas.router ? inferSessionType(opts.nasPortId) : "PPPOE";

  await db
    .insert(radiusAccountingTable)
    .values({
      tenantId: nas.tenantId,
      routerId: nas.router.id,
      customerId: mapping?.customerId ?? null,
      subscriptionId: mapping?.subscriptionId ?? null,
      sessionType,
      status: "ACTIVE",
      username: opts.username,
      acctSessionId: opts.acctSessionId,
      nasIpAddress: nas.router.ipAddress,
      nasPortId: opts.nasPortId ?? null,
      callingStationId: opts.callingStationId ?? null,
      framedIpAddress: opts.framedIp ?? null,
      startedAt: new Date(),
    })
    // A retransmitted Start (NAS didn't see our first ack) must not create
    // a duplicate session row — (routerId, acctSessionId) is unique, so
    // fold it into an update instead of erroring.
    .onConflictDoUpdate({
      target: [radiusAccountingTable.routerId, radiusAccountingTable.acctSessionId],
      set: { status: "ACTIVE", framedIpAddress: opts.framedIp ?? undefined, updatedAt: new Date() },
    });
}

async function handleInterim(opts: {
  nas: ResolvedNas; acctSessionId: string; bytesIn: number; bytesOut: number;
  packetsIn: number; packetsOut: number; sessionTime: number; framedIp: string | undefined;
}): Promise<void> {
  const { nas } = opts;
  const result = await db
    .update(radiusAccountingTable)
    .set({
      bytesIn: opts.bytesIn, bytesOut: opts.bytesOut, packetsIn: opts.packetsIn, packetsOut: opts.packetsOut,
      sessionTimeSec: opts.sessionTime, framedIpAddress: opts.framedIp ?? undefined,
      lastInterimAt: new Date(), updatedAt: new Date(),
    })
    .where(and(eq(radiusAccountingTable.routerId, nas.router.id), eq(radiusAccountingTable.acctSessionId, opts.acctSessionId)))
    .returning({ id: radiusAccountingTable.id });

  if (result.length === 0) {
    // Interim-Update for a session we never saw a Start for (we restarted,
    // or missed the Start packet) — synthesize a Start so the session is
    // still visible in "Online users" rather than silently dropped.
    await db.insert(radiusAccountingTable).values({
      tenantId: nas.tenantId, routerId: nas.router.id, sessionType: "PPPOE", status: "ACTIVE",
      username: "unknown", acctSessionId: opts.acctSessionId, nasIpAddress: nas.router.ipAddress,
      framedIpAddress: opts.framedIp ?? null, bytesIn: opts.bytesIn, bytesOut: opts.bytesOut,
      packetsIn: opts.packetsIn, packetsOut: opts.packetsOut, sessionTimeSec: opts.sessionTime,
      lastInterimAt: new Date(),
    }).onConflictDoNothing();
  }
}

async function handleStop(opts: {
  nas: ResolvedNas; acctSessionId: string; bytesIn: number; bytesOut: number;
  packetsIn: number; packetsOut: number; sessionTime: number; terminateCauseCode: number | undefined;
}): Promise<void> {
  const { nas } = opts;
  await db
    .update(radiusAccountingTable)
    .set({
      status: "STOPPED",
      bytesIn: opts.bytesIn, bytesOut: opts.bytesOut, packetsIn: opts.packetsIn, packetsOut: opts.packetsOut,
      sessionTimeSec: opts.sessionTime,
      terminateCause: terminateCauseLabel(opts.terminateCauseCode),
      endedAt: new Date(), updatedAt: new Date(),
    })
    .where(and(eq(radiusAccountingTable.routerId, nas.router.id), eq(radiusAccountingTable.acctSessionId, opts.acctSessionId)));
}

function inferSessionType(nasPortId: string | undefined): "PPPOE" | "HOTSPOT" {
  // RouterOS doesn't send a clean session-type attribute on every build; the
  // NAS-Port-Type / port-id convention differs by service. Default to PPPOE
  // (the primary RADIUS use case here) and let a future NAS-Port-Type read
  // refine this if a deployment needs Hotspot-via-RADIUS distinguished.
  return nasPortId?.toLowerCase().includes("hotspot") ? "HOTSPOT" : "PPPOE";
}

/** RFC 2866 §5.10 Acct-Terminate-Cause common values, for a human-readable audit trail. */
function terminateCauseLabel(code: number | undefined): string | null {
  if (code === undefined) return null;
  const labels: Record<number, string> = {
    1: "User-Request", 2: "Lost-Carrier", 3: "Lost-Service", 4: "Idle-Timeout",
    5: "Session-Timeout", 6: "Admin-Reset", 7: "Admin-Reboot", 8: "Port-Error",
    9: "NAS-Error", 10: "NAS-Request", 11: "NAS-Reboot", 15: "Service-Unavailable",
  };
  return labels[code] ?? `Cause-${code}`;
}

async function touchNasContact(routerId: string): Promise<void> {
  try {
    await db.update(routersTable).set({ lastRadiusContactAt: new Date() }).where(eq(routersTable.id, routerId));
  } catch {
    // best-effort, never block accounting on this
  }
}
