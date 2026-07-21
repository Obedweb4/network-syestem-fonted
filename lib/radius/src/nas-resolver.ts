import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { routersTable, radiusServerConfigTable, type Router } from "@workspace/db/schema";
import { decryptCredential } from "@workspace/crypto";

/**
 * A single UDP process serves every tenant on one shared auth/acct port
 * pair (radius_server_config per-tenant ports are advisory/display only —
 * see index.ts header for why). The only thing that separates one tenant's
 * traffic from another's on the wire is *which NAS sent it*: every packet
 * arrives from a specific router's IP, and a router row is already
 * tenant-scoped, so resolving the NAS by source IP resolves the tenant too.
 */
export interface ResolvedNas {
  router: Router;
  tenantId: string;
  secret: string;
}

const NEGATIVE_CACHE_MS = 5_000;
const nasCache = new Map<string, { value: ResolvedNas | null; expiresAt: number }>();

/** Clears the in-process NAS cache. Exposed for tests and for the admin "test RADIUS" action, which should never see a stale secret. */
export function clearNasCache(ip?: string): void {
  if (ip) nasCache.delete(ip);
  else nasCache.clear();
}

/**
 * Resolves the NAS (router) a packet claims to be from by its UDP source
 * IP, and the shared secret that should have signed it — the router's own
 * radiusSecretEncrypted if set, otherwise its tenant's
 * radius_server_config.defaultSecretEncrypted. Returns null (not a throw)
 * for any unrecognized source: a stranger sending us packets is routine on
 * an internet-facing UDP port, not an application error.
 */
export async function resolveNasBySourceIp(sourceIp: string): Promise<ResolvedNas | null> {
  const cached = nasCache.get(sourceIp);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [router] = await db
    .select()
    .from(routersTable)
    .where(and(eq(routersTable.ipAddress, sourceIp), eq(routersTable.isActive, true)))
    .limit(1);

  let resolved: ResolvedNas | null = null;
  if (router && router.radiusEnabled) {
    let secretEncrypted = router.radiusSecretEncrypted;
    if (!secretEncrypted) {
      const [cfg] = await db
        .select()
        .from(radiusServerConfigTable)
        .where(eq(radiusServerConfigTable.tenantId, router.tenantId))
        .limit(1);
      secretEncrypted = cfg?.enabled ? cfg.defaultSecretEncrypted : null;
    }
    if (secretEncrypted) {
      try {
        resolved = { router, tenantId: router.tenantId, secret: decryptCredential(secretEncrypted) };
      } catch {
        resolved = null; // corrupt/unreadable ciphertext — treat as unconfigured, never throw into the packet handler
      }
    }
  }

  // Cache both hits and misses briefly. A misconfigured/unknown NAS otherwise
  // means one DB round trip (or two) per dropped packet, and a flapping NAS
  // can retransmit fast.
  nasCache.set(sourceIp, { value: resolved, expiresAt: Date.now() + NEGATIVE_CACHE_MS });
  return resolved;
}

