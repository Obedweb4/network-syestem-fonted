import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: JWT_SECRET / SESSION_SECRET is not set in production");
      process.exit(1);
    }
    return "dev-secret-change-me";
  }
  return s;
})();

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser & { role?: string };
    // Reject customer portal tokens — they have role: "customer" and lack staff fields
    if ((payload as { role?: string }).role === "customer") {
      res.status(403).json({ error: "Forbidden: customer tokens cannot access staff routes" });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "15m" });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "7d" });
}

/**
 * Restricts a route to specific roles. Must run after requireAuth.
 * A user with no matching role gets 403, not a silent pass-through.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRoles = req.user?.roles ?? [];
    if (!userRoles.some((r) => roles.includes(r))) {
      res.status(403).json({ error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}

// --- Short-lived "2FA pending" token ---
// Issued after a correct password when the account has 2FA enabled. It proves
// the password step passed but is NOT a valid access token — it only unlocks
// POST /auth/login/2fa, and expires quickly so it can't be replayed later.
const TWO_FACTOR_PENDING_TYPE = "2fa_pending";

export function signTwoFactorPendingToken(userId: string): string {
  return jwt.sign({ sub: userId, type: TWO_FACTOR_PENDING_TYPE }, JWT_SECRET, { expiresIn: "5m" });
}

export function verifyTwoFactorPendingToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: string; type?: string };
    if (payload.type !== TWO_FACTOR_PENDING_TYPE || !payload.sub) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
