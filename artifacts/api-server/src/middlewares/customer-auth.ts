import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthCustomer {
  id: string;
  tenantId: string;
  phone: string;
  accountNumber: string | null;
  role: "customer";
}

declare global {
  namespace Express {
    interface Request {
      customer?: AuthCustomer;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? "dev-secret-change-me";

export function requireCustomerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthCustomer;
    if (payload.role !== "customer") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    req.customer = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Like requireCustomerAuth, but does not reject the request when no/invalid
 * token is present — it simply leaves `req.customer` unset. Used by routes
 * (e.g. the captive-portal buy flow) that work for both guests and signed-in
 * customers.
 */
export function optionalCustomerAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next();
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthCustomer;
    if (payload.role === "customer") {
      req.customer = payload;
    }
  } catch {
    // Ignore invalid/expired tokens — treat as guest.
  }
  next();
}

export function signCustomerAccessToken(customer: AuthCustomer): string {
  return jwt.sign(customer, JWT_SECRET, { expiresIn: "15m" });
}

export function signCustomerRefreshToken(customerId: string): string {
  return jwt.sign({ sub: customerId, role: "customer" }, JWT_SECRET, { expiresIn: "7d" });
}
