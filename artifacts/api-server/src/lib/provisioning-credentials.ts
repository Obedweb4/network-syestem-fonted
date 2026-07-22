import crypto from "crypto";
import type { Customer } from "@workspace/db/schema";

/**
 * At-rest encryption for router-side subscriber passwords
 * (provisioning_mappings.pppoePasswordEncrypted). AES-256-GCM with a key
 * from PROVISIONING_CREDENTIAL_KEY (32 bytes, base64) — never derived from
 * JWT_SECRET or any other secret already in use, so rotating one doesn't
 * silently break the other. Ciphertext format: base64(iv):base64(authTag):base64(ciphertext).
 *
 * This exists so support staff can look up (via POST
 * /subscriptions/:id/reveal-password, audit-logged) what a customer's
 * router credentials currently are without re-deriving or resetting them —
 * the same reason a real ISP's RADIUS/billing system keeps this recoverable
 * rather than only hashed.
 *
 * The actual AES-GCM implementation now lives in @workspace/crypto (shared
 * with the RADIUS server, which needs to decrypt these same ciphertexts
 * from a separate process) — re-exported here so every existing import of
 * `encryptCredential`/`decryptCredential` from this module keeps working
 * unchanged.
 */
export { encryptCredential, decryptCredential } from "@workspace/crypto";

/**
 * Deterministic-ish username (stable prefix per customer, unique suffix per
 * subscription) + a fresh random password. Shared by every provisioning
 * path (payment activation, manual admin provisioning, reprovisioning,
 * password reset) so router usernames follow one convention platform-wide.
 */
export function generateRouterCredentials(customer: Customer, subscriptionId: string): { username: string; password: string } {
  const base = (customer.accountNumber ?? customer.phone).replace(/\D/g, "").slice(-8) || customer.id.slice(0, 8);
  const suffix = subscriptionId.replace(/-/g, "").slice(0, 6);
  return { username: `pn_${base}_${suffix}`.toLowerCase(), password: generatePassword() };
}

export function generatePassword(): string {
  return crypto.randomBytes(9).toString("base64url");
}
