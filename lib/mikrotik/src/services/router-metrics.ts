import { MikroTikClient } from "../client";
import type { RouterConfig } from "../types";

/**
 * Router Metrics Collection for the AI NOC
 *
 * A single full-stats poll of one router: system resource (CPU/memory/
 * uptime), PPPoE + Hotspot active counts, and cumulative byte counters on
 * its uplink interface. Returns raw *cumulative* counters, not rates — the
 * caller (services/noc-collector.ts, in the api-server) is responsible for
 * diffing against the previous sample to derive bits/sec, because only the
 * caller knows what "previous" means (persisted history, poll cadence).
 *
 * This intentionally duplicates a little of what routers.ts's `/monitor`
 * endpoint and dashboard.ts's `liveNetwork()` already do inline — this
 * codebase's convention is a small tailored poll per consumer rather than
 * one shared mega-abstraction (see also services/active-sessions.ts vs.
 * services/hotspot-sessions.ts), and unlike those two this one is built to
 * run unattended on a schedule across every router in every tenant, so it
 * intentionally fetches the minimum needed for that (no interface-by-
 * interface table, no log tail) rather than the full on-demand detail view.
 *
 * NOT responsible for:
 * - Persistence, rate/delta computation, status classification (collector)
 * - Alerting, anomaly detection, forecasting (noc-analysis.ts)
 */

export interface RouterMetricsResult {
  reachable: boolean;
  cpuLoadPercent: number | null;
  memoryUsedPercent: number | null;
  uptimeSeconds: number | null;
  pppoeActiveCount: number | null;
  hotspotActiveCount: number | null;
  /** Name of the interface these byte totals were read from, or null if none could be determined (no running non-loopback interface, or the router returned nothing). */
  wanInterfaceName: string | null;
  /** Cumulative counters since the interface last reset — a rate, not a snapshot value. Zero (not null) when unreachable, so callers can diff safely without extra null-checks. */
  rxBytes: number;
  txBytes: number;
  error?: string;
  errorCode?: string;
}

function num(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function list(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : data ? [data as Record<string, unknown>] : [];
}

/** RouterOS reports uptime like "6w2d10h30m5s" (or a subset of those tokens) — sum the tokens present rather than assuming all five appear. */
export function parseRouterOsUptime(uptime: unknown): number | null {
  if (typeof uptime !== "string" || !uptime) return null;
  const unitSeconds: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  const re = /(\d+)([wdhms])/g;
  let total = 0;
  let matchedAny = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(uptime)) !== null) {
    matchedAny = true;
    total += Number(match[1]) * unitSeconds[match[2]];
  }
  return matchedAny ? total : null;
}

/**
 * Picks which interface represents "the internet uplink" for bandwidth
 * purposes: the explicit pin if given and present, else the running,
 * non-loopback, non-disabled interface with the highest cumulative
 * throughput (a reasonable heuristic — the WAN link is almost always the
 * busiest physical/VLAN interface on an access router). Returns null (not a
 * guess) when nothing qualifies, so callers don't silently chart garbage.
 */
function pickWanInterface(interfaces: Array<Record<string, unknown>>, wanInterfaceHint?: string | null): Record<string, unknown> | null {
  const candidates = interfaces.filter((i) => {
    const running = i.running === true || i.running === "true";
    const disabled = i.disabled === true || i.disabled === "true";
    const type = String(i.type ?? "");
    return running && !disabled && type !== "loopback" && type !== "bridge"; // bridges double-count member interface traffic
  });
  if (wanInterfaceHint) {
    const pinned = candidates.find((i) => i.name === wanInterfaceHint) ?? interfaces.find((i) => i.name === wanInterfaceHint);
    if (pinned) return pinned;
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((busiest, current) => {
    const busiestTotal = (num(busiest["rx-byte"]) ?? 0) + (num(busiest["tx-byte"]) ?? 0);
    const currentTotal = (num(current["rx-byte"]) ?? 0) + (num(current["tx-byte"]) ?? 0);
    return currentTotal > busiestTotal ? current : busiest;
  });
}

export async function collectRouterMetrics(router: RouterConfig, wanInterfaceHint?: string | null): Promise<RouterMetricsResult> {
  const client = new MikroTikClient(router);
  const empty = { rxBytes: 0, txBytes: 0, wanInterfaceName: null, cpuLoadPercent: null, memoryUsedPercent: null, uptimeSeconds: null, pppoeActiveCount: null, hotspotActiveCount: null };

  try {
    const connectResult = await client.connect();
    if (!connectResult.success) {
      return { reachable: false, ...empty, error: connectResult.error ?? connectResult.message, errorCode: connectResult.errorCode };
    }

    const [resourceRes, pppoeRes, hotspotRes, ifaceRes] = await Promise.allSettled([
      client.run("/system/resource", "print", {}),
      client.run("/ppp/active", "print", {}),
      client.run("/ip/hotspot/active", "print", {}),
      client.run("/interface", "print", {}),
    ]);

    const resource = resourceRes.status === "fulfilled" && resourceRes.value.success ? list(resourceRes.value.data)[0] ?? {} : {};
    const pppoeCount = pppoeRes.status === "fulfilled" && pppoeRes.value.success ? list(pppoeRes.value.data).length : null;
    const hotspotCount = hotspotRes.status === "fulfilled" && hotspotRes.value.success ? list(hotspotRes.value.data).length : null;
    const interfaces = ifaceRes.status === "fulfilled" && ifaceRes.value.success ? list(ifaceRes.value.data) : [];
    const wan = pickWanInterface(interfaces, wanInterfaceHint);

    const freeMemory = num(resource["free-memory"]);
    const totalMemory = num(resource["total-memory"]);
    const memoryUsedPercent = freeMemory != null && totalMemory ? Math.round(((totalMemory - freeMemory) / totalMemory) * 100) : null;

    return {
      reachable: true,
      cpuLoadPercent: num(resource["cpu-load"]),
      memoryUsedPercent,
      uptimeSeconds: parseRouterOsUptime(resource.uptime),
      pppoeActiveCount: pppoeCount,
      hotspotActiveCount: hotspotCount,
      wanInterfaceName: wan ? String(wan.name ?? "") : null,
      rxBytes: wan ? num(wan["rx-byte"]) ?? 0 : 0,
      txBytes: wan ? num(wan["tx-byte"]) ?? 0 : 0,
    };
  } catch (error) {
    return { reachable: false, ...empty, error: error instanceof Error ? error.message : String(error), errorCode: "METRICS_EXCEPTION" };
  } finally {
    await client.disconnect().catch(() => {});
  }
}
