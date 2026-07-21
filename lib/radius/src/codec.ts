import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Minimal, dependency-free RADIUS (RFC 2865 Authentication, RFC 2866
 * Accounting, RFC 2869 extensions) wire codec.
 *
 * Deliberately hand-rolled instead of pulling in a third-party RADIUS
 * package: the protocol surface PulseNet actually needs (PAP/CHAP
 * Access-Request, Access-Accept/Reject with a small fixed set of reply
 * attributes, Accounting-Request Start/Interim-Update/Stop, and outbound
 * Disconnect-Request for CoA) is small and security-sensitive (password
 * decryption, response-authenticator signing) — implementing it directly
 * against the RFCs means no unreviewed dependency sits between customer
 * credentials and the wire.
 */

export const RadiusCode = {
  ACCESS_REQUEST: 1,
  ACCESS_ACCEPT: 2,
  ACCESS_REJECT: 3,
  ACCOUNTING_REQUEST: 4,
  ACCOUNTING_RESPONSE: 5,
  ACCESS_CHALLENGE: 11,
  DISCONNECT_REQUEST: 40,
  DISCONNECT_ACK: 41,
  DISCONNECT_NAK: 42,
} as const;
export type RadiusCode = (typeof RadiusCode)[keyof typeof RadiusCode];

/** Standard RADIUS attribute type numbers actually used by PulseNet. */
export const Attr = {
  USER_NAME: 1,
  USER_PASSWORD: 2,
  CHAP_PASSWORD: 3,
  NAS_IP_ADDRESS: 4,
  NAS_PORT: 5,
  SERVICE_TYPE: 6,
  FRAMED_PROTOCOL: 7,
  FRAMED_IP_ADDRESS: 8,
  FRAMED_IP_NETMASK: 9,
  FILTER_ID: 11,
  FRAMED_MTU: 12,
  REPLY_MESSAGE: 18,
  VENDOR_SPECIFIC: 26,
  SESSION_TIMEOUT: 27,
  IDLE_TIMEOUT: 28,
  TERMINATION_ACTION: 29,
  CALLED_STATION_ID: 30,
  CALLING_STATION_ID: 31,
  NAS_IDENTIFIER: 32,
  ACCT_STATUS_TYPE: 40,
  ACCT_DELAY_TIME: 41,
  ACCT_INPUT_OCTETS: 42,
  ACCT_OUTPUT_OCTETS: 43,
  ACCT_SESSION_ID: 44,
  ACCT_AUTHENTIC: 45,
  ACCT_SESSION_TIME: 46,
  ACCT_INPUT_PACKETS: 47,
  ACCT_OUTPUT_PACKETS: 48,
  ACCT_TERMINATE_CAUSE: 49,
  CHAP_CHALLENGE: 60,
  NAS_PORT_TYPE: 61,
  ACCT_INPUT_GIGAWORDS: 52,
  ACCT_OUTPUT_GIGAWORDS: 53,
  FRAMED_POOL: 88,
  MESSAGE_AUTHENTICATOR: 80,
  ERROR_CAUSE: 101,
} as const;

export const AcctStatusType = {
  START: 1,
  STOP: 2,
  INTERIM_UPDATE: 3,
  ACCOUNTING_ON: 7,
  ACCOUNTING_OFF: 8,
} as const;

/** MikroTik RouterOS vendor-specific attributes (Vendor-Id 14988). */
export const MIKROTIK_VENDOR_ID = 14988;
export const MikrotikAttr = {
  RATE_LIMIT: 8,
  REALM: 9,
  HOST_IP: 14,
  MARK_ID: 15,
  ADDRESS_LIST: 19,
  GROUP: 2,
} as const;

export interface RawAttribute {
  type: number;
  value: Buffer;
}

export interface DecodedPacket {
  code: number;
  identifier: number;
  authenticator: Buffer;
  attributes: RawAttribute[];
  raw: Buffer;
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

export function attrString(type: number, value: string): RawAttribute {
  return { type, value: Buffer.from(value, "utf8") };
}

export function attrUint32(type: number, value: number): RawAttribute {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value >>> 0, 0);
  return { type, value: b };
}

export function attrIpAddress(type: number, ip: string): RawAttribute {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    // Non-IPv4 (or unknown) address — encode as zero rather than throw, since
    // this only ever affects an optional reply attribute.
    return { type, value: Buffer.from([0, 0, 0, 0]) };
  }
  return { type, value: Buffer.from(parts) };
}

/** Vendor-Specific wrapper (RFC 2865 §5.26): Vendor-Id(4) + Vendor-Type(1) + Vendor-Length(1) + Vendor-Data. */
export function attrVendorSpecific(vendorId: number, vendorType: number, value: Buffer): RawAttribute {
  const header = Buffer.alloc(6);
  header.writeUInt32BE(vendorId, 0);
  header[4] = vendorType;
  header[5] = value.length + 2;
  return { type: Attr.VENDOR_SPECIFIC, value: Buffer.concat([header, value]) };
}

export function mikrotikAttr(vendorType: number, value: string): RawAttribute {
  return attrVendorSpecific(MIKROTIK_VENDOR_ID, vendorType, Buffer.from(value, "utf8"));
}

/** Decodes a Vendor-Specific attribute value back into (vendorId, vendorType, data), for reading Mikrotik VSAs sent *by* the NAS in Access-Request/Accounting-Request packets. */
export function decodeVendorSpecific(value: Buffer): { vendorId: number; vendorType: number; data: Buffer } | null {
  if (value.length < 6) return null;
  return { vendorId: value.readUInt32BE(0), vendorType: value[4]!, data: value.subarray(6, 6 + (value[5]! - 2)) };
}

export function findAttr(attrs: RawAttribute[], type: number): RawAttribute | undefined {
  return attrs.find((a) => a.type === type);
}

export function findAllAttrs(attrs: RawAttribute[], type: number): RawAttribute[] {
  return attrs.filter((a) => a.type === type);
}

export function attrToString(attr?: RawAttribute): string | undefined {
  return attr ? attr.value.toString("utf8") : undefined;
}

export function attrToUint32(attr?: RawAttribute): number | undefined {
  return attr && attr.value.length >= 4 ? attr.value.readUInt32BE(0) : undefined;
}

// ---------------------------------------------------------------------------
// Packet decode / encode
// ---------------------------------------------------------------------------

export function decodePacket(buf: Buffer): DecodedPacket {
  if (buf.length < 20) throw new Error("RADIUS packet too short");
  const code = buf[0]!;
  const identifier = buf[1]!;
  const length = buf.readUInt16BE(2);
  const authenticator = buf.subarray(4, 20);
  const attributes: RawAttribute[] = [];
  let offset = 20;
  const end = Math.min(length, buf.length);
  while (offset < end) {
    const type = buf[offset]!;
    const attrLen = buf[offset + 1]!;
    if (attrLen < 2 || offset + attrLen > end) break; // malformed — stop, don't throw (never trust wire input from a NAS)
    attributes.push({ type, value: buf.subarray(offset + 2, offset + attrLen) });
    offset += attrLen;
  }
  return { code, identifier, authenticator, attributes, raw: buf.subarray(0, length) };
}

function encodeAttributes(attrs: RawAttribute[]): Buffer {
  return Buffer.concat(
    attrs.map((a) => Buffer.concat([Buffer.from([a.type, a.value.length + 2]), a.value])),
  );
}

/**
 * Builds an Access-Accept/Reject or Accounting-Response, signed with the
 * standard RFC 2865 §3 response authenticator:
 *   MD5(Code + Identifier + Length + RequestAuthenticator + Attributes + Secret)
 */
export function encodeResponse(opts: {
  code: number;
  identifier: number;
  requestAuthenticator: Buffer;
  secret: string;
  attributes: RawAttribute[];
}): Buffer {
  const attrBuf = encodeAttributes(opts.attributes);
  const length = 20 + attrBuf.length;
  const header = Buffer.alloc(4);
  header[0] = opts.code;
  header[1] = opts.identifier;
  header.writeUInt16BE(length, 2);

  const toHash = Buffer.concat([header, opts.requestAuthenticator, attrBuf, Buffer.from(opts.secret, "utf8")]);
  const responseAuthenticator = createHash("md5").update(toHash).digest();

  return Buffer.concat([header, responseAuthenticator, attrBuf]);
}

/** Builds a request-type packet (Disconnect-Request/CoA-Request) we originate ourselves, using a random authenticator per RFC 5176. */
export function encodeRequest(opts: { code: number; identifier: number; secret: string; attributes: RawAttribute[] }): Buffer {
  const authenticator = randomBytes(16);
  const attrBuf = encodeAttributes(opts.attributes);
  const length = 20 + attrBuf.length;
  const header = Buffer.alloc(4);
  header[0] = opts.code;
  header[1] = opts.identifier;
  header.writeUInt16BE(length, 2);

  // RFC 5176 §3: request authenticator is itself MD5(Code+ID+Length+16 zero
  // octets+Attributes+Secret), unlike the all-zero placeholder used for a
  // plain Access-Request from a client.
  const zeroAuth = Buffer.alloc(16);
  const toHash = Buffer.concat([header, zeroAuth, attrBuf, Buffer.from(opts.secret, "utf8")]);
  const requestAuthenticator = createHash("md5").update(toHash).digest();

  return Buffer.concat([header, requestAuthenticator, attrBuf]);
}

// ---------------------------------------------------------------------------
// Password handling
// ---------------------------------------------------------------------------

/** RFC 2865 §5.2 User-Password decryption (repeated MD5-XOR chaining in 16-byte blocks). */
export function decryptPapPassword(encrypted: Buffer, secret: string, requestAuthenticator: Buffer): string {
  const secretBuf = Buffer.from(secret, "utf8");
  const blocks = encrypted.length / 16;
  const out = Buffer.alloc(encrypted.length);
  let prev = requestAuthenticator;
  for (let i = 0; i < blocks; i++) {
    const hash = createHash("md5").update(Buffer.concat([secretBuf, prev])).digest();
    const cipherBlock = encrypted.subarray(i * 16, i * 16 + 16);
    for (let j = 0; j < 16; j++) out[i * 16 + j] = cipherBlock[j]! ^ hash[j]!;
    prev = cipherBlock;
  }
  // Strip trailing NUL padding.
  const nul = out.indexOf(0);
  return (nul === -1 ? out : out.subarray(0, nul)).toString("utf8");
}

/**
 * RFC 2865 §2.2 CHAP verification. `chapPasswordAttr` is CHAP-Ident(1) +
 * CHAP-Response(16). The challenge is CHAP-Challenge if the NAS sent one,
 * otherwise the request authenticator itself.
 */
export function verifyChapPassword(chapPasswordAttr: Buffer, challenge: Buffer, plaintextPassword: string): boolean {
  if (chapPasswordAttr.length !== 17) return false;
  const ident = chapPasswordAttr.subarray(0, 1);
  const response = chapPasswordAttr.subarray(1);
  const expected = createHash("md5").update(Buffer.concat([ident, Buffer.from(plaintextPassword, "utf8"), challenge])).digest();
  return expected.length === response.length && timingSafeEqual(expected, response);
}

/** Constant-time secret comparison — used when validating a NAS's configured shared secret rather than trusting string equality timing. */
export function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
