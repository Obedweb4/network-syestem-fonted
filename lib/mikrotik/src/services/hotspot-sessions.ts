import { MikroTikClient } from "../client";
import type { RouterConfig } from "../types";

/**
 * Active Hotspot Session Counting Service for PulseNet Billing
 *
 * Responsibilities:
 * - Count LIVE hotspot sessions directly from MikroTik (/ip/hotspot/active),
 *   never from the hotspot_sessions DB table, since that table can drift
 *   from what's actually connected on the router (e.g. missed "logged out"
 *   events, router reboots, etc).
 * - Fail gracefully per-router: an unreachable router contributes 0 to the
 *   total instead of failing the whole dashboard request.
 *
 * NOT responsible for:
 * - Persisting session history (see hotspot_sessions table for that)
 * - Hotspot user provisioning
 */

/**
 * Count active (currently connected) hotspot sessions on a single router by
 * querying RouterOS `/ip/hotspot/active print` directly.
 *
 * Opens a short-lived connection dedicated to this call and always closes it
 * afterwards - callers should not hold a shared/long-lived client for this.
 *
 * @returns 0 if the router is unreachable or the command fails (logged, not thrown)
 */
export async function countActiveHotspotSessions(router: RouterConfig): Promise<number> {
  const client = new MikroTikClient(router);

  try {
    const connectResult = await client.connect();
    if (!connectResult.success) {
      console.error(
        `[mikrotik] Router "${router.name}" (${router.id}) unreachable while counting active hotspot sessions: ${connectResult.message ?? connectResult.error}`
      );
      return 0;
    }

    const activeResult = await client.run("/ip/hotspot/active", "print", {});
    if (!activeResult.success) {
      console.error(
        `[mikrotik] Router "${router.name}" (${router.id}) failed to return active hotspot sessions: ${activeResult.message ?? activeResult.error}`
      );
      return 0;
    }

    const sessions = Array.isArray(activeResult.data)
      ? activeResult.data
      : activeResult.data
        ? [activeResult.data]
        : [];

    return sessions.length;
  } catch (error) {
    console.error(
      `[mikrotik] Unexpected error counting active hotspot sessions for router "${router.name}" (${router.id}):`,
      error
    );
    return 0;
  } finally {
    await client.disconnect();
  }
}

/**
 * Count active hotspot sessions across multiple routers (e.g. all routers
 * for a tenant) in parallel, tolerating individual router failures.
 */
export async function countActiveHotspotUsers(routers: RouterConfig[]): Promise<number> {
  if (routers.length === 0) return 0;
  const counts = await Promise.all(routers.map((r) => countActiveHotspotSessions(r)));
  return counts.reduce((sum, c) => sum + c, 0);
}

export interface ActiveHotspotSession {
  id: string;
  username: string;
  address?: string;
  macAddress?: string;
  uptime?: string;
}

/** Lists every currently-connected Hotspot session on a router, for the admin "live sessions" view. */
export async function listActiveHotspotSessions(router: RouterConfig): Promise<ActiveHotspotSession[]> {
  const client = new MikroTikClient(router);
  try {
    const connectResult = await client.connect();
    if (!connectResult.success) {
      console.error(`[mikrotik] Router "${router.name}" (${router.id}) unreachable while listing active hotspot sessions: ${connectResult.message ?? connectResult.error}`);
      return [];
    }
    const activeResult = await client.run("/ip/hotspot/active", "print", {});
    if (!activeResult.success) return [];
    const sessions = Array.isArray(activeResult.data) ? activeResult.data : activeResult.data ? [activeResult.data] : [];
    return sessions.map((s) => {
      const row = s as Record<string, unknown>;
      return {
        id: row[".id"] as string,
        username: row.user as string,
        address: row.address as string | undefined,
        macAddress: row["mac-address"] as string | undefined,
        uptime: row.uptime as string | undefined,
      };
    });
  } catch (error) {
    console.error(`[mikrotik] Unexpected error listing active hotspot sessions for router "${router.name}" (${router.id}):`, error);
    return [];
  } finally {
    await client.disconnect();
  }
}

/** Force-disconnects a single live Hotspot session by its RouterOS `.id`. */
export async function disconnectHotspotSession(router: RouterConfig, sessionId: string): Promise<{ success: boolean; error?: string }> {
  const client = new MikroTikClient(router);
  try {
    const connectResult = await client.connect();
    if (!connectResult.success) return { success: false, error: connectResult.error ?? connectResult.message };
    const result = await client.run("/ip/hotspot/active", "remove", { numbers: sessionId });
    if (!result.success) return { success: false, error: result.error ?? result.message };
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.disconnect();
  }
}
