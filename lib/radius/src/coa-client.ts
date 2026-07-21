import dgram from "node:dgram";
import { RadiusCode, Attr, attrString, encodeRequest, decodePacket } from "./codec";

export interface DisconnectResult {
  acked: boolean;
  nak: boolean;
  error?: string;
}

/**
 * Sends a Disconnect-Request (RFC 5176) to a NAS for one active session,
 * identified by username (RouterOS accepts User-Name-only Disconnect-Requests
 * for both PPPoE and Hotspot). Used by the admin API when staff suspend a
 * customer or explicitly kick a session — without this, a RADIUS-authenticated
 * session that was already Access-Accepted keeps running on the router until
 * its own Session-Timeout/Idle-Timeout fires, even after PulseNet marks the
 * subscription SUSPENDED.
 *
 * Resolves rather than throws on timeout/NAK — the caller (an admin route)
 * should tell staff "disconnect request sent, not yet acknowledged" instead
 * of a 500, since the subscription-level suspend already happened and is the
 * durable source of truth regardless of whether the NAS ACKs in time.
 */
export function sendDisconnectRequest(opts: {
  nasIpAddress: string;
  nasPort?: number;
  secret: string;
  username: string;
  timeoutMs?: number;
}): Promise<DisconnectResult> {
  const { nasIpAddress, nasPort = 3799, secret, username, timeoutMs = 3000 } = opts;

  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;

    const finish = (result: DisconnectResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };

    const timer = setTimeout(() => finish({ acked: false, nak: false, error: "timeout" }), timeoutMs);

    socket.on("error", (err) => finish({ acked: false, nak: false, error: err.message }));

    socket.on("message", (msg) => {
      try {
        const decoded = decodePacket(msg);
        if (decoded.code === RadiusCode.DISCONNECT_ACK) finish({ acked: true, nak: false });
        else if (decoded.code === RadiusCode.DISCONNECT_NAK) finish({ acked: false, nak: true });
        else finish({ acked: false, nak: false, error: `unexpected response code ${decoded.code}` });
      } catch (err) {
        finish({ acked: false, nak: false, error: err instanceof Error ? err.message : "decode error" });
      }
    });

    const packet = encodeRequest({
      code: RadiusCode.DISCONNECT_REQUEST,
      identifier: Math.floor(Math.random() * 256),
      secret,
      attributes: [attrString(Attr.USER_NAME, username)],
    });

    socket.send(packet, nasPort, nasIpAddress, (err) => {
      if (err) finish({ acked: false, nak: false, error: err.message });
    });
  });
}
