import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Antenna, Gauge, Users, ScrollText, RefreshCw, PlugZap, Router as RouterIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types matching artifacts/api-server/src/routes/radius.ts response shapes.
// No OpenAPI/codegen coverage exists yet for these endpoints, so these are
// hand-written to match the route file — same reasoning as routers.tsx's
// hand-rolled test-connection/pppoe-sessions calls elsewhere in this app.
// ---------------------------------------------------------------------------

interface RadiusConfig {
  tenantId: string;
  enabled: boolean;
  authPort: number;
  acctPort: number;
  defaultSessionTimeoutSec: number | null;
  defaultIdleTimeoutSec: number | null;
  defaultFramedPool: string | null;
  interimUpdateIntervalSec: number;
  hasDefaultSecret: boolean;
}

interface RadiusOverview {
  onlineSessions: number;
  last24h: { accepts: number; rejects: number };
  nasRouters: { id: string; name: string; lastRadiusContactAt: string | null }[];
}

interface RadiusSession {
  id: string;
  username: string;
  sessionType: "PPPOE" | "HOTSPOT";
  status: "ACTIVE" | "STOPPED";
  framedIpAddress: string | null;
  callingStationId: string | null;
  bytesIn: number;
  bytesOut: number;
  sessionTimeSec: number;
  startedAt: string;
}

interface RadiusAuthEvent {
  id: string;
  username: string;
  result: "ACCESS_ACCEPT" | "ACCESS_REJECT";
  reasonCode: string;
  reasonMessage: string | null;
  nasIpAddress: string | null;
  callingStationId: string | null;
  createdAt: string;
}

const CONFIG_ROLES = ["super_admin", "business_owner"];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function RadiusPage() {
  const { user } = useAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const view = (new URLSearchParams(search).get("view") ?? "overview") as "overview" | "online" | "events";

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Antenna className="w-5 h-5 text-primary" />
              RADIUS
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Centralized AAA for PPPoE/Hotspot subscribers authenticated via RADIUS
            </p>
          </div>
        </div>

        <Tabs value={view} onValueChange={(v) => setLocation(v === "overview" ? "/radius" : `/radius?view=${v}`)}>
          <TabsList>
            <TabsTrigger value="overview" className="gap-1.5"><Gauge className="h-3.5 w-3.5" />Overview</TabsTrigger>
            <TabsTrigger value="online" className="gap-1.5"><Users className="h-3.5 w-3.5" />Online Users</TabsTrigger>
            <TabsTrigger value="events" className="gap-1.5"><ScrollText className="h-3.5 w-3.5" />Auth Events</TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "overview" && <OverviewTab canEditConfig={(user?.roles ?? []).some((r) => CONFIG_ROLES.includes(r.toLowerCase()))} />}
        {view === "online" && <OnlineUsersTab />}
        {view === "events" && <AuthEventsTab />}
      </div>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Overview: on/off + ports + defaults, plus live 24h/online counts and NAS list
// ---------------------------------------------------------------------------

function OverviewTab({ canEditConfig }: { canEditConfig: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["radius-config"],
    queryFn: () => customFetch<RadiusConfig>("/api/radius/config"),
  });
  const { data: overview } = useQuery({
    queryKey: ["radius-overview"],
    queryFn: () => customFetch<RadiusOverview>("/api/radius/overview"),
    refetchInterval: 15_000,
  });

  const [form, setForm] = useState<{
    enabled: boolean; authPort: string; acctPort: string; defaultSecret: string;
    defaultSessionTimeoutSec: string; defaultIdleTimeoutSec: string; defaultFramedPool: string;
    interimUpdateIntervalSec: string;
  } | null>(null);

  // Seed the editable form from the fetched config exactly once per load —
  // after that, `form` is the source of truth for the inputs so typing
  // doesn't get clobbered by the query's background refetches.
  if (config && !form) {
    setForm({
      enabled: config.enabled,
      authPort: String(config.authPort),
      acctPort: String(config.acctPort),
      defaultSecret: "",
      defaultSessionTimeoutSec: config.defaultSessionTimeoutSec != null ? String(config.defaultSessionTimeoutSec) : "",
      defaultIdleTimeoutSec: config.defaultIdleTimeoutSec != null ? String(config.defaultIdleTimeoutSec) : "",
      defaultFramedPool: config.defaultFramedPool ?? "",
      interimUpdateIntervalSec: String(config.interimUpdateIntervalSec),
    });
  }

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Form not ready");
      const body: Record<string, unknown> = {
        enabled: form.enabled,
        authPort: Number(form.authPort),
        acctPort: Number(form.acctPort),
        defaultSessionTimeoutSec: form.defaultSessionTimeoutSec ? Number(form.defaultSessionTimeoutSec) : null,
        defaultIdleTimeoutSec: form.defaultIdleTimeoutSec ? Number(form.defaultIdleTimeoutSec) : null,
        defaultFramedPool: form.defaultFramedPool || null,
        interimUpdateIntervalSec: Number(form.interimUpdateIntervalSec),
      };
      // Only send a new secret if the admin actually typed one — an empty
      // field must never overwrite an already-configured shared secret.
      if (form.defaultSecret) body.defaultSecret = form.defaultSecret;
      return customFetch<RadiusConfig>("/api/radius/config", { method: "PUT", body: JSON.stringify(body) });
    },
    onSuccess: (saved) => {
      qc.setQueryData(["radius-config"], saved);
      setForm((f) => (f ? { ...f, defaultSecret: "" } : f));
      toast({ title: "RADIUS configuration saved" });
    },
    onError: (err) => toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      {/* Live counts */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-md p-3 text-center">
          <p className="text-2xl font-bold">{overview?.onlineSessions ?? "—"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Online Now</p>
        </div>
        <div className="bg-card border border-border rounded-md p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{overview?.last24h.accepts ?? "—"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Accepts (24h)</p>
        </div>
        <div className="bg-card border border-border rounded-md p-3 text-center">
          <p className="text-2xl font-bold text-red-600">{overview?.last24h.rejects ?? "—"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Rejects (24h)</p>
        </div>
      </div>

      {/* Config form */}
      <div className="bg-card border border-border rounded-md p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Server Configuration</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Requires the <code className="text-[11px]">@workspace/radius-server</code> process running separately — see DEPLOYMENT.md.
            </p>
          </div>
          {form && (
            <div className="flex items-center gap-2">
              <Switch checked={form.enabled} disabled={!canEditConfig} onCheckedChange={(v) => setForm((f) => f && { ...f, enabled: v })} />
              <span className="text-xs font-medium">{form.enabled ? "Enabled" : "Disabled"}</span>
            </div>
          )}
        </div>

        {configLoading && <p className="text-xs text-muted-foreground">Loading configuration…</p>}

        {form && (
          <>
            {!canEditConfig && (
              <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
                Only Super Admin / Business Owner can change RADIUS configuration. You can view current settings below.
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Auth Port</Label>
                <Input type="number" disabled={!canEditConfig} value={form.authPort} onChange={(e) => setForm((f) => f && { ...f, authPort: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Accounting Port</Label>
                <Input type="number" disabled={!canEditConfig} value={form.acctPort} onChange={(e) => setForm((f) => f && { ...f, acctPort: e.target.value })} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">
                  Default Shared Secret {config?.hasDefaultSecret && <span className="text-muted-foreground font-normal">(already set — leave blank to keep it)</span>}
                </Label>
                <Input
                  type="password"
                  disabled={!canEditConfig}
                  placeholder={config?.hasDefaultSecret ? "••••••••" : "Not yet configured"}
                  value={form.defaultSecret}
                  onChange={(e) => setForm((f) => f && { ...f, defaultSecret: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Used by any NAS that doesn't have its own secret set on the router record. Overridden per-router when one is configured there.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default Session Timeout (sec)</Label>
                <Input type="number" disabled={!canEditConfig} value={form.defaultSessionTimeoutSec} onChange={(e) => setForm((f) => f && { ...f, defaultSessionTimeoutSec: e.target.value })} placeholder="Plan-level value, if set, wins" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default Idle Timeout (sec)</Label>
                <Input type="number" disabled={!canEditConfig} value={form.defaultIdleTimeoutSec} onChange={(e) => setForm((f) => f && { ...f, defaultIdleTimeoutSec: e.target.value })} placeholder="Plan-level value, if set, wins" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default Framed Pool</Label>
                <Input disabled={!canEditConfig} value={form.defaultFramedPool} onChange={(e) => setForm((f) => f && { ...f, defaultFramedPool: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Interim Update Interval (sec)</Label>
                <Input type="number" disabled={!canEditConfig} value={form.interimUpdateIntervalSec} onChange={(e) => setForm((f) => f && { ...f, interimUpdateIntervalSec: e.target.value })} />
              </div>
            </div>
            {canEditConfig && (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save Configuration"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* NAS (router) contact status */}
      <div className="bg-card border border-border rounded-md">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold flex items-center gap-1.5"><RouterIcon className="h-4 w-4" />RADIUS-Enabled Routers</p>
        </div>
        {!overview?.nasRouters.length ? (
          <p className="text-xs text-muted-foreground p-4">
            No router has RADIUS enabled yet. Turn it on per-router from the Routers page once this tenant's config above is saved.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Router</TableHead><TableHead>Last RADIUS Contact</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {overview.nasRouters.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">{relativeTime(r.lastRadiusContactAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Online Users: live RADIUS-accounted sessions, with a CoA disconnect action
// ---------------------------------------------------------------------------

function OnlineUsersTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const { data: sessions, isLoading, refetch } = useQuery({
    queryKey: ["radius-online"],
    queryFn: () => customFetch<RadiusSession[]>("/api/radius/sessions/online"),
    refetchInterval: 10_000,
  });

  const disconnect = useMutation({
    mutationFn: (sessionId: string) => customFetch<{ acked: boolean; nak: boolean; error?: string }>("/api/radius/sessions/disconnect", { method: "POST", body: JSON.stringify({ sessionId }) }),
    onMutate: (sessionId) => setDisconnecting(sessionId),
    onSuccess: (result) => {
      toast({ title: result.acked ? "Session disconnected" : "Disconnect request sent", description: result.acked ? undefined : "Router hasn't acknowledged yet — it will drop once it processes the request." });
      qc.invalidateQueries({ queryKey: ["radius-online"] });
    },
    onError: (err) => toast({ title: "Disconnect failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
    onSettled: () => setDisconnecting(null),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
          Refresh
        </Button>
      </div>
      <div className="bg-card border border-border rounded-md">
        {isLoading && <p className="text-xs text-muted-foreground p-4">Loading online sessions…</p>}
        {!isLoading && !sessions?.length && <p className="text-xs text-muted-foreground p-4">No active RADIUS sessions right now.</p>}
        {!!sessions?.length && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Framed IP</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>Data (in/out)</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.username}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{s.sessionType}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{s.framedIpAddress ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{s.callingStationId ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatBytes(s.bytesIn)} / {formatBytes(s.bytesOut)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDuration(s.sessionTimeSec)}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(s.startedAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={disconnecting === s.id} onClick={() => disconnect.mutate(s.id)}>
                      <PlugZap className="w-3.5 h-3.5 mr-1" />
                      {disconnecting === s.id ? "Sending…" : "Disconnect"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth Events: Access-Accept/Reject audit trail
// ---------------------------------------------------------------------------

function AuthEventsTab() {
  const [resultFilter, setResultFilter] = useState<string>("");

  const { data: events, isLoading } = useQuery({
    queryKey: ["radius-auth-events", resultFilter],
    queryFn: () => customFetch<RadiusAuthEvent[]>(`/api/radius/auth-events${resultFilter ? `?result=${resultFilter}` : ""}`),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Select value={resultFilter} onValueChange={setResultFilter}>
          <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="All results" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All results</SelectItem>
            <SelectItem value="ACCESS_ACCEPT">Accepted</SelectItem>
            <SelectItem value="ACCESS_REJECT">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="bg-card border border-border rounded-md">
        {isLoading && <p className="text-xs text-muted-foreground p-4">Loading auth events…</p>}
        {!isLoading && !events?.length && <p className="text-xs text-muted-foreground p-4">No RADIUS authentication events yet.</p>}
        {!!events?.length && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>NAS IP</TableHead>
                <TableHead>MAC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{e.username}</TableCell>
                  <TableCell>
                    <Badge className={e.result === "ACCESS_ACCEPT" ? "bg-green-500/10 text-green-700 hover:bg-green-500/10" : "bg-red-500/10 text-red-700 hover:bg-red-500/10"}>
                      {e.result === "ACCESS_ACCEPT" ? "Accept" : "Reject"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{e.reasonMessage ?? e.reasonCode}</TableCell>
                  <TableCell className="text-muted-foreground">{e.nasIpAddress ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{e.callingStationId ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
