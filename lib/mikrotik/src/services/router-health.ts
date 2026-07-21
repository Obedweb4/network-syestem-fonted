import { MikroTikClient } from "../client";
import type { RouterConfig } from "../types";

/**
 * Router Reachability Service for PulseNet Billing
 *
 * Responsibilities:
 * - Determine "Active Routers" for the dashboard via a LIVE connection check
 *   against each configured router, never by counting `is_active` DB rows,
 *   since a router can be marked active in the DB while being physically
 *   offline or unreachable.
 * - Fail gracefully per-router: an unreachable router is simply excluded
 *   from the reachable count instead of failing the whole dashboard request.
 *
 * NOT responsible for:
 * - Router CRUD / configuration management
 * - Alerting (see router_alerts table for that)
 */

/**
 * Check whether a single router is currently reachable by opening a
 * short-lived MikroTik API connection to it.
 *
 * Opens a dedicated connection for this check and always closes it
 * afterwards - callers should not hold a shared/long-lived client for this.
 *
 * @returns true if the router accepted the connection, false otherwise (logged, never throws)
 */
export async function isRouterReachable(router: RouterConfig): Promise<boolean> {
  const client = new MikroTikClient(router);

  try {
    const connectResult = await client.connect();
    if (!connectResult.success) {
      console.error(
        `[mikrotik] Router "${router.name}" (${router.id}) unreachable during live reachability check: ${connectResult.message ?? connectResult.error}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `[mikrotik] Unexpected error during live reachability check for router "${router.name}" (${router.id}):`,
      error
    );
    return false;
  } finally {
    await client.disconnect();
  }
}

/**
 * Count how many of the given routers are currently reachable, by
 * performing a live connection check against each one in parallel.
 */
export async function countReachableRouters(routers: RouterConfig[]): Promise<number> {
  if (routers.length === 0) return 0;
  const results = await Promise.all(routers.map((r) => isRouterReachable(r)));
  return results.filter(Boolean).length;
}
