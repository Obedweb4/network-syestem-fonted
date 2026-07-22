import dgram from "node:dgram";
import type { Logger } from "pino";
import {
  decodePacket,
  RadiusCode,
  resolveNasBySourceIp,
  handleAccessRequest,
  handleAccountingRequest,
} from "@workspace/radius";

export interface RadiusUdpServer {
  close: () => Promise<void>;
}

/**
 * Starts one UDP socket bound to `port`, dispatching every datagram to
 * `handler`. Both the auth (1812) and accounting (1813) listeners share this
 * same shape — only which handler runs on each packet differs.
 *
 * Design note: this process serves *every tenant* on one shared port pair,
 * multiplexed by NAS source IP (see lib/radius/src/nas-resolver.ts). RADIUS
 * has no concept of a "tenant ID" on the wire, and running one OS process
 * per tenant to honor radius_server_config's per-tenant port fields would
 * mean juggling an unbounded, dynamically-changing set of listening sockets
 * as tenants are added — a NAS's source IP already uniquely resolves both
 * the NAS and its tenant, so that's what this uses. The per-tenant port
 * fields in radius_server_config remain purely informational/display
 * (Admin > RADIUS "your NAS should point at <host>:<configured port>"),
 * not something this process binds to individually.
 */
function startUdpListener(opts: {
  port: number;
  host: string;
  logger: Logger;
  onPacket: (msg: Buffer, rinfo: dgram.RemoteInfo, socket: dgram.Socket) => void;
}): Promise<dgram.Socket> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.on("error", (err) => {
      opts.logger.error({ err, port: opts.port }, "RADIUS UDP socket error");
    });
    socket.on("message", (msg, rinfo) => {
      try {
        opts.onPacket(msg, rinfo, socket);
      } catch (err) {
        opts.logger.error({ err, from: rinfo.address }, "Unhandled error processing RADIUS packet");
      }
    });
    socket.bind(opts.port, opts.host, () => resolve(socket));
    socket.once("error", reject);
  });
}

export async function startRadiusUdpServers(opts: {
  authPort: number;
  acctPort: number;
  host: string;
  logger: Logger;
}): Promise<RadiusUdpServer> {
  const { authPort, acctPort, host, logger } = opts;

  const authSocket = await startUdpListener({
    port: authPort,
    host,
    logger,
    onPacket: (msg, rinfo, socket) => {
      void (async () => {
        const nas = await resolveNasBySourceIp(rinfo.address);
        if (!nas) {
          logger.warn({ from: rinfo.address }, "Access-Request from unrecognized/disabled NAS — dropped");
          return; // never reply to a source we can't authenticate as a known NAS
        }
        let decoded;
        try {
          decoded = decodePacket(msg);
        } catch (err) {
          logger.warn({ err, from: rinfo.address }, "Malformed RADIUS auth packet — dropped");
          return;
        }
        if (decoded.code !== RadiusCode.ACCESS_REQUEST) return; // only Access-Request belongs on the auth port
        const outcome = await handleAccessRequest(decoded, nas);
        socket.send(outcome.responseBuffer, rinfo.port, rinfo.address);
      })().catch((err) => logger.error({ err, from: rinfo.address }, "Access-Request handling failed"));
    },
  });

  const acctSocket = await startUdpListener({
    port: acctPort,
    host,
    logger,
    onPacket: (msg, rinfo, socket) => {
      void (async () => {
        const nas = await resolveNasBySourceIp(rinfo.address);
        if (!nas) {
          logger.warn({ from: rinfo.address }, "Accounting-Request from unrecognized/disabled NAS — dropped");
          return;
        }
        let decoded;
        try {
          decoded = decodePacket(msg);
        } catch (err) {
          logger.warn({ err, from: rinfo.address }, "Malformed RADIUS acct packet — dropped");
          return;
        }
        if (decoded.code !== RadiusCode.ACCOUNTING_REQUEST) return;
        const outcome = await handleAccountingRequest(decoded, nas);
        socket.send(outcome.responseBuffer, rinfo.port, rinfo.address);
      })().catch((err) => logger.error({ err, from: rinfo.address }, "Accounting-Request handling failed"));
    },
  });

  logger.info({ authPort, acctPort, host }, "RADIUS UDP listeners started");

  return {
    close: async () => {
      await Promise.all([
        new Promise<void>((r) => authSocket.close(() => r())),
        new Promise<void>((r) => acctSocket.close(() => r())),
      ]);
    },
  };
}
