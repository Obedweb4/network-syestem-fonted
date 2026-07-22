import type { Response } from "express";
import { logger } from "../lib/logger";

/**
 * Real-time push for the NOC dashboard via Server-Sent Events.
 *
 * In-process pub/sub: fine for a single api-server instance (the common
 * deployment for this project — see index.ts's single `app.listen`). If
 * this is ever run as multiple horizontally-scaled instances behind a load
 * balancer, a client's SSE connection only receives events broadcast by the
 * instance it's connected to — broadcasting would need to move to a shared
 * channel (e.g. Postgres LISTEN/NOTIFY, or Redis pub/sub) so every instance
 * relays every tenant's events. Documented here rather than silently
 * papered over, since it's the one part of this feature that doesn't scale
 * past one process as-is; the collector/analysis logic that PRODUCES these
 * events has no such limitation.
 */

export type NocEventType =
  | "router.status_changed"
  | "router.snapshot"
  | "incident.opened"
  | "incident.updated"
  | "incident.resolved"
  | "recommendation.created"
  | "recommendation.updated";

export interface NocEvent {
  type: NocEventType;
  data: Record<string, unknown>;
  at: string;
}

const subscribers = new Map<string, Set<Response>>();

export function subscribe(tenantId: string, res: Response): () => void {
  let set = subscribers.get(tenantId);
  if (!set) {
    set = new Set();
    subscribers.set(tenantId, set);
  }
  set.add(res);
  return () => {
    set?.delete(res);
    if (set && set.size === 0) subscribers.delete(tenantId);
  };
}

export function broadcast(tenantId: string, event: Omit<NocEvent, "at">): void {
  const set = subscribers.get(tenantId);
  if (!set || set.size === 0) return;
  const payload: NocEvent = { ...event, at: new Date().toISOString() };
  const chunk = `event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(chunk);
    } catch (err) {
      logger.error({ err, tenantId }, "Failed writing NOC SSE event; dropping subscriber");
      set.delete(res);
    }
  }
}

export function subscriberCount(tenantId: string): number {
  return subscribers.get(tenantId)?.size ?? 0;
}
