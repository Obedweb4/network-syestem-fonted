import crypto from "crypto";

/**
 * At-rest encryption for secrets PulseNet stores and later needs back in
 * plaintext: router-side subscriber passwords
 * (provisioning_mappings.pppoePasswordEncrypted), and now RADIUS shared
 * secrets (routers.radiusSecretEncrypted, radius_server_config.defaultSecretEncrypted).
 * AES-256-GCM with a key from PROVISIONING_CREDENTIAL_KEY (32 bytes, base64).
 *
 * This used to live only in artifacts/api-server/src/lib/provisioning-credentials.ts.
 * It's extracted here, unchanged, so the RADIUS server (@workspace/radius,
 * a separate process from api-server) can decrypt the exact same
 * ciphertexts without a second implementation of the cipher — two
 * implementations of an AES-GCM routine are two places a subtle bug (wrong
 * IV length, wrong tag handling) could silently diverge. api-server's
 * provisioning-credentials.ts now re-exports these instead of defining its
 * own copy.
 */

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.PROVISIONING_CREDENTIAL_KEY;
  if (!raw) {
    throw new Error(
      "PROVISIONING_CREDENTIAL_KEY is not set. Generate one with `openssl rand -base64 32` and add it to the deployment secret store before provisioning any PPPoE/Hotspot subscriber or enabling RADIUS.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("PROVISIONING_CREDENTIAL_KEY must decode to exactly 32 bytes (base64 of `openssl rand -base64 32`).");
  }
  cachedKey = key;
  return key;
}

export function encryptCredential(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptCredential(stored: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Stored credential is not in the expected iv:tag:data format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
