import { useEffect, useRef } from "react";
import { getAuthToken, getBaseUrl } from "@workspace/api-client-react";

export interface NocStreamEvent {
  type: string;
  data: Record<string, unknown>;
  at: string;
}

/**
 * Subscribes to GET /api/noc/stream (Server-Sent Events) for live NOC
 * updates. Deliberately not using the browser's native `EventSource` — it
 * has no way to attach the `Authorization: Bearer <token>` header this app's
 * auth relies on (see middlewares/auth.ts's requireAuth, which only reads
 * that header, no cookie/query fallback) — so this reads the stream
 * manually via `fetch` + a `ReadableStream` reader instead. Auto-reconnects
 * with backoff on any drop; always cleans up on unmount.
 */
export function useNocStream(onEvent: (event: NocStreamEvent) => void, enabled = true): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let stopped = false;
    let retryDelay = 1000;

    async function connect() {
      while (!stopped) {
        try {
          const token = await getAuthToken();
          const base = getBaseUrl() ?? "";
          const response = await fetch(`${base}/api/noc/stream`, {
            headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`Stream connect failed: ${response.status}`);

          retryDelay = 1000; // reset backoff once a connection succeeds
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const lines = part.split("\n");
              let eventType = "message";
              let dataRaw = "";
              for (const line of lines) {
                if (line.startsWith("event:")) eventType = line.slice(6).trim();
                else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
              }
              if (eventType === "connected" || !dataRaw) continue;
              try {
                const parsed = JSON.parse(dataRaw) as NocStreamEvent;
                onEventRef.current(parsed);
              } catch {
                // malformed/heartbeat frame — ignore rather than crash the stream
              }
            }
          }
        } catch (err) {
          if (stopped || (err instanceof DOMException && err.name === "AbortError")) return;
        }
        if (stopped) return;
        await new Promise((r) => setTimeout(r, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    }

    void connect();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [enabled]);
}
