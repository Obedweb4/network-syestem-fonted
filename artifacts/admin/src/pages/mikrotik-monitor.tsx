import { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListRouters, getListRoutersQueryKey } from "@workspace/api-client-react";
import {
  Activity, RefreshCw, Wifi, WifiOff, Cpu, MemoryStick,
  Clock, Users, ArrowDownToLine, ArrowUpFromLine, Terminal,
  ChevronDown, ChevronRight, BarChart3, ScrollText, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation, useSearch } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrafficView } from "@/components/noc/TrafficView";
import { LogsView } from "@/components/noc/LogsView";
import { AiNocView } from "@/components/noc/AiNocView";

/* ── types ──────────────────────────────────────────────────────────────── */
interface MonitorData {
  reachable: boolean;
  routerName: string;
  ipAddress?: string;
  identity?: string;
  boardName?: string;
  version?: string;
  uptime?: string;
  cpuLoad?: string | number;
  freeMemory?: number;
  totalMemory?: number;
  architecture?: string;
  pppoeCount?: number;
  hotspotCount?: number;
  connectedClients?: number;
  interfaces?: {
    name: string; type: string; running: boolean; disabled: boolean;
    rxBytes: number; txBytes: number; rxPackets: number; txPackets: number;
  }[];
  logs?: { time: string | null; topics: string | null; message: string | null }[];
  error?: string;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */
function fmtBytes(b: number) {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(2)} GB`;
  if (b >= 1048576)    return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024)       return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}
function fmtMem(b?: number) { return b ? fmtBytes(b) : "—"; }

function MemBar({ free, total }: { free?: number; total?: number }) {
  if (!free || !total) return <span className="text-muted-foreground">—</span>;
  const used = total - free;
  const pct  = Math.round((used / total) * 100);
  const color = pct > 85 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span>{fmtMem(used)} used</span>
        <span className="text-muted-foreground">{fmtMem(total)} total</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CpuBar({ load }: { load?: string | number }) {
  const pct = load != null ? Number(load) : null;
  if (pct == null || isNaN(pct)) return <span className="text-muted-foreground">—</span>;
  const color = pct > 85 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span>{pct}%</span>
        <span className="text-muted-foreground">CPU load</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: React.ReactNode; sub?: string; color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-md p-3 flex items-start gap-3">
      <div className={`w-7 h-7 rounded-sm flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5">{typeof value === "string" || typeof value === "number"
          ? <p className="text-sm font-bold">{value}</p>
          : value}
        </div>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ── per-router monitor panel ────────────────────────────────────────────── */
function RouterMonitorCard({ router }: { router: any }) {
  const [data, setData]         = useState<MonitorData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fetched, setFetched]   = useState(false);

  const fetchMonitor = useCallback(async () => {
    setLoading(true);
    try {
      const token = sessionStorage.getItem("pn_token");
      const res = await fetch(`/api/routers/${router.id}/monitor`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        setData({ reachable: false, routerName: router.name, error: `API error ${res.status}: ${errText}` });
        setFetched(true);
        return;
      }
      const json: MonitorData = await res.json();
      setData(json);
      setFetched(true);
      setExpanded(true);
    } catch {
      setData({ reachable: false, routerName: router.name, error: "Network error" });
      setFetched(true);
    } finally {
      setLoading(false);
    }
  }, [router.id, router.name]);

  const online = data?.reachable;

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      {/* ── header row ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => {
          if (!fetched) { fetchMonitor(); }
          else setExpanded(e => !e);
        }}
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${
          !fetched ? "bg-muted-foreground" : online ? "bg-green-500" : "bg-red-500"
        }`} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{router.name}</p>
          <p className="text-xs text-muted-foreground font-mono">{router.ipAddress}:{router.apiPort ?? 8728}</p>
        </div>

        {data && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-sm ${
            online
              ? "bg-green-500/10 text-green-700"
              : "bg-red-500/10 text-red-700"
          }`}>
            {online ? "Online" : "Offline"}
          </span>
        )}

        <button
          onClick={e => { e.stopPropagation(); fetchMonitor(); }}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground p-1 rounded-sm transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>

        {fetched
          ? expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                     : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        }
      </div>

      {/* ── expanded detail ── */}
      {expanded && data && (
        <div className="border-t border-border px-4 py-4 space-y-5">
          {!online ? (
            <div className="flex items-center gap-2 text-sm text-red-600 py-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>Router unreachable{data.error ? ` — ${data.error}` : ""}</span>
            </div>
          ) : (
            <>
              {/* identity strip */}
              {(data.boardName || data.version || data.uptime || data.architecture) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {data.boardName  && <span>Board: <span className="text-foreground font-medium">{data.boardName}</span></span>}
                  {data.version    && <span>RouterOS: <span className="text-foreground font-medium">{data.version}</span></span>}
                  {data.uptime     && <span>Uptime: <span className="text-foreground font-medium">{data.uptime}</span></span>}
                  {data.architecture && <span>Arch: <span className="text-foreground font-medium">{data.architecture}</span></span>}
                </div>
              )}

              {/* stat tiles */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatTile
                  icon={Cpu} label="CPU Usage" color="bg-blue-500/10 text-blue-600"
                  value={<CpuBar load={data.cpuLoad} />}
                />
                <StatTile
                  icon={MemoryStick} label="Memory" color="bg-purple-500/10 text-purple-600"
                  value={<MemBar free={data.freeMemory} total={data.totalMemory} />}
                />
                <StatTile
                  icon={Clock} label="Uptime" color="bg-teal-500/10 text-teal-600"
                  value={data.uptime ?? "—"}
                />
                <StatTile
                  icon={Wifi} label="Active PPPoE" color="bg-primary/10 text-primary"
                  value={data.pppoeCount ?? 0}
                  sub="live sessions"
                />
                <StatTile
                  icon={Activity} label="Active Hotspot" color="bg-cyan-500/10 text-cyan-600"
                  value={data.hotspotCount ?? 0}
                  sub="live sessions"
                />
                <StatTile
                  icon={Users} label="Connected Clients" color="bg-green-500/10 text-green-600"
                  value={data.connectedClients ?? 0}
                  sub="PPPoE + Hotspot"
                />
              </div>

              {/* interface traffic */}
              {data.interfaces && data.interfaces.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Interface Traffic
                  </p>
                  <div className="bg-card border border-border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          {["Interface", "Type", "Status", "Download (RX)", "Upload (TX)"].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data.interfaces.filter(i => !i.disabled).map(iface => (
                          <tr key={iface.name}>
                            <td className="px-3 py-2 text-xs font-mono font-medium">{iface.name}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{iface.type ?? "—"}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                                iface.running ? "text-green-600" : "text-muted-foreground"
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${iface.running ? "bg-green-500" : "bg-muted-foreground"}`} />
                                {iface.running ? "Up" : "Down"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <ArrowDownToLine className="w-3 h-3 text-blue-500" />
                                {fmtBytes(iface.rxBytes)}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <ArrowUpFromLine className="w-3 h-3 text-green-500" />
                                {fmtBytes(iface.txBytes)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* system logs */}
              {data.logs && data.logs.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    System Logs (latest {data.logs.length})
                  </p>
                  <div className="bg-muted/30 border border-border rounded-md overflow-hidden">
                    <div className="divide-y divide-border/50 max-h-64 overflow-y-auto">
                      {data.logs.map((log, i) => (
                        <div key={i} className="flex items-start gap-3 px-3 py-1.5">
                          <Terminal className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {log.time && (
                                <span className="text-xs text-muted-foreground font-mono">{log.time}</span>
                              )}
                              {log.topics && (
                                <span className="text-xs px-1 py-0.5 bg-primary/10 text-primary rounded-sm">{log.topics}</span>
                              )}
                            </div>
                            <p className="text-xs mt-0.5">{log.message ?? "—"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* loading state inside card */}
      {loading && !data && (
        <div className="border-t border-border px-4 py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Connecting to router…
        </div>
      )}
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */
export default function MikroTikMonitorPage() {
  const { data: routers, isLoading, refetch } = useListRouters(
    {},
    { query: { queryKey: getListRoutersQueryKey({}) } }
  );

  const activeRouters = routers?.filter(r => r.isActive) ?? [];
  const inactiveRouters = routers?.filter(r => !r.isActive) ?? [];

  // Matches the sidebar's existing sub-links (Overview/Traffic/Logs/AI NOC
  // all point at /network-monitor?view=...) — bare /network-monitor keeps
  // its original behavior (the router list below) unchanged.
  const search = useSearch();
  const [, setLocation] = useLocation();
  const view = (new URLSearchParams(search).get("view") ?? "routers") as "routers" | "traffic" | "logs" | "ai";

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              MikroTik Monitor
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live stats from all configured MikroTik routers
            </p>
          </div>
          {view === "routers" && (
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Refresh List
            </Button>
          )}
        </div>

        <Tabs value={view} onValueChange={(v) => setLocation(v === "routers" ? "/network-monitor" : `/network-monitor?view=${v}`)}>
          <TabsList>
            <TabsTrigger value="routers" className="gap-1.5"><Activity className="h-3.5 w-3.5" />Overview</TabsTrigger>
            <TabsTrigger value="traffic" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Traffic</TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5"><ScrollText className="h-3.5 w-3.5" />Logs</TabsTrigger>
            <TabsTrigger value="ai" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" />AI NOC</TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "traffic" && <TrafficView />}
        {view === "logs" && <LogsView />}
        {view === "ai" && <AiNocView />}

        {view === "routers" && (<>
        {/* summary bar */}
        {routers && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-card border border-border rounded-md p-3 text-center">
              <p className="text-2xl font-bold">{routers.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total Routers</p>
            </div>
            <div className="bg-card border border-border rounded-md p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{activeRouters.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Configured Active</p>
            </div>
            <div className="bg-card border border-border rounded-md p-3 text-center">
              <p className="text-2xl font-bold text-muted-foreground">{inactiveRouters.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Inactive</p>
            </div>
          </div>
        )}

        {/* router list */}
        {isLoading && (
          <div className="text-xs text-muted-foreground py-12 text-center">Loading routers…</div>
        )}

        {!isLoading && !routers?.length && (
          <div className="bg-card border border-border rounded-md py-12 text-center">
            <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm font-medium">No routers configured</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add routers on the <Link href="/routers" className="text-primary hover:underline">Routers</Link> page to monitor them here.
            </p>
          </div>
        )}

        {activeRouters.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Active Routers — click a row to pull live stats
            </p>
            {activeRouters.map(r => (
              <RouterMonitorCard key={r.id} router={r} />
            ))}
          </div>
        )}

        {inactiveRouters.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Inactive Routers
            </p>
            {inactiveRouters.map(r => (
              <div key={r.id} className="bg-card border border-border rounded-md px-4 py-3 flex items-center gap-3 opacity-50">
                <div className="w-2 h-2 rounded-full bg-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{r.ipAddress}:{r.apiPort ?? 8728}</p>
                </div>
                <span className="ml-auto text-xs text-muted-foreground">Inactive</span>
              </div>
            ))}
          </div>
        )}
        </>)}
      </div>
    </AppLayout>
  );
}
