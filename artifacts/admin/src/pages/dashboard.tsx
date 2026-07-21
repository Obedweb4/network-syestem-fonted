import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useGetRevenueChart, getGetRevenueChartQueryKey,
  useGetRecentActivity, getGetRecentActivityQueryKey,
  useGetSubscriptionStats, getGetSubscriptionStatsQueryKey,
  useGetAiAnalysis, getGetAiAnalysisQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { Users, Wifi, DollarSign, FileText, Ticket, Signal, Brain, RefreshCw, AlertTriangle, AlertCircle, Info, CheckCircle, ChevronRight } from "lucide-react";

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string | number; sub?: string; icon: any; color: string }) {
  return (
    <div className="bg-card border border-border rounded-md p-4 flex items-start gap-3">
      <div className={`w-8 h-8 rounded-sm flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold mt-0.5 leading-none" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function HealthScoreRing({ score }: { score: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative w-20 h-20 shrink-0">
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/30" />
        <circle
          cx="36" cy="36" r={radius} fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold leading-none">{score}</span>
        <span className="text-[9px] text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

const ALERT_STYLES = {
  critical: { icon: AlertCircle, className: "text-red-600 bg-red-500/10 border-red-200" },
  warning: { icon: AlertTriangle, className: "text-yellow-600 bg-yellow-500/10 border-yellow-200" },
  info: { icon: Info, className: "text-blue-600 bg-blue-500/10 border-blue-200" },
};

function AiAnalystWidget() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data: analysis, isLoading, isFetching } = useGetAiAnalysis({ query: { queryKey: getGetAiAnalysisQueryKey(), staleTime: 60_000 } });
  const [trafficHistory, setTrafficHistory] = useState<Array<{ time: string; down: number; up: number }>>([]);
  const { data: live } = useQuery({
    queryKey: ["network-live"],
    queryFn: () => customFetch<{ sampledAt: string; totals: { trafficInBps: number; trafficOutBps: number; online: number } }>("/api/dashboard/network-live", { responseType: "json" }),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!live) return;
    setTrafficHistory((history) => [...history, {
      time: new Date(live.sampledAt).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
      down: Math.round(live.totals.trafficInBps / 1024), up: Math.round(live.totals.trafficOutBps / 1024),
    }].slice(-24));
  }, [live]);

  function handleRefresh() {
    setRefreshing(true);
    qc.invalidateQueries({ queryKey: getGetAiAnalysisQueryKey() });
    setTimeout(() => setRefreshing(false), 1500);
  }

  const loading = isLoading || isFetching;

  return (
    <div className="bg-card border border-border rounded-md">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold">AI Network Analyst</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          data-testid="btn-ai-refresh"
        >
          <RefreshCw className={`w-3 h-3 ${loading || refreshing ? "animate-spin" : ""}`} />
          {loading ? "Analyzing…" : "Refresh"}
        </button>
      </div>

      {isLoading && !analysis ? (
        <div className="p-6 flex items-center justify-center">
          <div className="text-center space-y-2">
            <Brain className="w-8 h-8 text-primary/40 mx-auto animate-pulse" />
            <p className="text-xs text-muted-foreground">Analyzing network health…</p>
          </div>
        </div>
      ) : analysis ? (
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-4">
            <HealthScoreRing score={analysis.healthScore} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Network Health</p>
              <p className="text-xs leading-relaxed text-foreground/80">{analysis.summary}</p>
              {analysis.analyzedAt && (
                <p className="text-xs text-muted-foreground mt-2">
                  Last analyzed: {new Date(analysis.analyzedAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-sm border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live network traffic</p>
              <span className="text-[10px] text-muted-foreground">{live ? `${live.totals.online} routers online • refreshes every 10s` : "Connecting…"}</span>
            </div>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={trafficHistory}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(214.3 31.8% 91.4%)" />
                <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}K`} width={34} />
                <Tooltip formatter={(v: number, name: string) => [`${Number(v).toLocaleString()} KB/s`, name === "down" ? "Download" : "Upload"]} />
                <Line type="monotone" dataKey="down" name="down" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="up" name="up" stroke="#16a34a" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {analysis.alerts && analysis.alerts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Alerts ({analysis.alerts.length})</p>
              {analysis.alerts.map((alert, i) => {
                const { icon: Icon, className } = ALERT_STYLES[alert.severity as keyof typeof ALERT_STYLES] ?? ALERT_STYLES.info;
                return (
                  <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-sm border text-xs ${className}`}>
                    <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{alert.message}</span>
                  </div>
                );
              })}
            </div>
          )}

          {analysis.recommendedActions && analysis.recommendedActions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recommended Actions</p>
              {analysis.recommendedActions.map((action, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
                  <span className="text-foreground/80">{action}</span>
                </div>
              ))}
            </div>
          )}

          {(!analysis.alerts?.length && !analysis.recommendedActions?.length) && (
            <div className="flex items-center gap-2 text-xs text-green-600">
              <CheckCircle className="w-4 h-4" />
              <span>All systems operating normally. No actions required.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="p-6 text-center text-xs text-muted-foreground">
          Unable to load analysis. Click Refresh to try again.
        </div>
      )}
    </div>
  );
}

const PIE_COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#6b7280"];

export default function DashboardPage() {
  const { data: summary } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: revenue } = useGetRevenueChart({ query: { queryKey: getGetRevenueChartQueryKey() } });
  const { data: activity } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });
  const { data: stats } = useGetSubscriptionStats({ query: { queryKey: getGetSubscriptionStatsQueryKey() } });

  const pieData = stats ? [
    { name: "Active", value: stats.active },
    { name: "Suspended", value: stats.suspended },
    { name: "Expired", value: stats.expired },
    { name: "Cancelled", value: stats.cancelled },
  ] : [];

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl">
        <div>
          <h1 className="text-lg font-bold">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Network operations overview</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Clients"
            value={summary?.totalCustomers ?? "—"}
            sub={summary ? `PPPoE: ${summary.pppoeClients ?? 0} • Hotspot: ${summary.hotspotClients ?? 0}` : undefined}
            icon={Users}
            color="bg-blue-500/10 text-blue-600"
          />
          <StatCard label="Active PPPoE" value={summary?.activePppoeUsers ?? "—"} icon={Signal} color="bg-teal-500/10 text-teal-600" />
          <StatCard label="Month Revenue" value={summary ? `KES ${Number(summary.monthRevenue).toLocaleString()}` : "—"} sub={`Today: KES ${Number(summary?.todayRevenue ?? 0).toLocaleString()}`} icon={DollarSign} color="bg-primary/10 text-primary" />
          <StatCard label="Active Subscriptions" value={summary?.activeSubscriptions ?? "—"} icon={Wifi} color="bg-green-500/10 text-green-600" />
          <StatCard label="Pending Invoices" value={summary?.pendingInvoices ?? "—"} icon={FileText} color="bg-orange-500/10 text-orange-600" />
          <StatCard label="Hotspot Sessions" value={summary?.activeHotspotSessions ?? "—"} icon={Wifi} color="bg-cyan-500/10 text-cyan-600" />
          <StatCard label="Unused Vouchers" value={summary?.unusedVouchers ?? "—"} icon={Ticket} color="bg-yellow-500/10 text-yellow-600" />
          <StatCard label="Expiring In 7 Days" value={summary?.expiringSubscriptions ?? "—"} icon={Wifi} color="bg-red-500/10 text-red-600" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-card border border-border rounded-md p-4">
            <p className="text-sm font-semibold mb-4">Revenue (30 days)</p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={revenue ?? []}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(130 65% 40%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(130 65% 40%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214.3 31.8% 91.4%)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => [`KES ${Number(v).toLocaleString()}`, "Revenue"]} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(130 65% 40%)" fill="url(#rev)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-md p-4">
            <p className="text-sm font-semibold mb-4">Subscriptions</p>
            {pieData.some(d => d.value > 0) ? (
              <>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value">
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-1 mt-2">
                  {pieData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i] }} />
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="font-medium ml-auto">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[140px] flex items-center justify-center text-xs text-muted-foreground">No data yet</div>
            )}
          </div>
        </div>

        <AiAnalystWidget />

        <div className="bg-card border border-border rounded-md">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold">Recent Activity</p>
          </div>
          <div className="divide-y divide-border">
            {(activity ?? []).slice(0, 8).map(a => (
              <div key={a.id} className="px-4 py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{a.description}</p>
                  <p className="text-xs text-muted-foreground capitalize">{a.type}</p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(a.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
            {!activity?.length && (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">No recent activity</div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
