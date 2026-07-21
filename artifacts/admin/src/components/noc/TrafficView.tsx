import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listNocRouters, getRouterHistory } from "@/lib/noc-api";

function formatBps(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value}`;
}

export function TrafficView() {
  const [routerId, setRouterId] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const routers = useQuery({ queryKey: ["noc", "routers"], queryFn: listNocRouters });
  const activeRouterId = routerId ?? routers.data?.routers[0]?.id ?? null;
  const history = useQuery({
    queryKey: ["noc", "history", activeRouterId, hours],
    queryFn: () => getRouterHistory(activeRouterId!, hours),
    enabled: Boolean(activeRouterId),
  });

  const chartData = (history.data?.snapshots ?? []).map((s) => ({
    time: new Date(s.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    rx: s.rxBps != null ? Number(s.rxBps) : null,
    tx: s.txBps != null ? Number(s.txBps) : null,
    pppoe: s.pppoeActiveCount,
    hotspot: s.hotspotActiveCount,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={activeRouterId ?? ""}
          onChange={(e) => setRouterId(e.target.value)}
        >
          {routers.data?.routers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <div className="flex gap-1">
          {[6, 24, 24 * 7].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`rounded-md border px-3 py-1.5 text-xs ${hours === h ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
            >
              {h < 24 ? `${h}h` : `${h / 24}d`}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Bandwidth</CardTitle></CardHeader>
        <CardContent className="h-72">
          {chartData.length === 0 ? (
            <p className="pt-8 text-center text-sm text-muted-foreground">No traffic history yet for this router — the collector samples every 60s, so a chart will appear shortly after this router comes online.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={40} />
                <YAxis tickFormatter={formatBps} tick={{ fontSize: 11 }} width={48} />
                <Tooltip formatter={(v: number) => formatBps(v) + "bps"} />
                <Legend />
                <Line type="monotone" dataKey="rx" name="Download" stroke="#3b82f6" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="tx" name="Upload" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Active sessions</CardTitle></CardHeader>
        <CardContent className="h-56">
          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 11 }} width={36} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="pppoe" name="PPPoE" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="hotspot" name="Hotspot" stroke="#a855f7" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
