import { authenticator } from "otplib";

const ISSUER = "PulseNet";

/** Generates a new base32 TOTP secret for a user setting up 2FA. */
export function generateTwoFactorSecret(): string {
  return authenticator.generateSecret();
}

/** otpauth:// URI for rendering as a QR code in an authenticator app. */
export function twoFactorKeyUri(email: string, secret: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

/** Verifies a 6-digit TOTP code against the stored secret (30s window ±1 step). */
export function verifyTwoFactorCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}
