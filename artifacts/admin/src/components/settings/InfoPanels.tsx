import { useQuery } from "@tanstack/react-query";
import { useListRouters, getListRoutersQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ExternalLink, Wifi, Lock, ShieldCheck, Receipt, Cpu, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getSystemInfo } from "@/lib/settings-api";

function StatRow({ label, value }: { label: string; value: string | number }) {
  return <div className="flex justify-between text-xs py-1"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>;
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-muted-foreground">{label}</span>
      {ok ? <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="w-3.5 h-3.5" />Configured</span> : <span className="flex items-center gap-1 text-muted-foreground"><XCircle className="w-3.5 h-3.5" />Not configured</span>}
    </div>
  );
}

export function RoutersPanel() {
  const list = useListRouters({}, { query: { queryKey: getListRoutersQueryKey({}) } });
  const active = list.data?.filter((r: any) => r.isActive).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="mb-2"><h2 className="text-base font-semibold">Routers</h2><p className="text-xs text-muted-foreground mt-0.5">Router inventory and MikroTik connection details live on their own page.</p></div>
      <Card>
        <CardContent className="pt-6 space-y-1">
          <StatRow label="Total routers" value={list.data?.length ?? "—"} />
          <StatRow label="Active" value={active} />
          <div className="pt-3"><Link href="/routers"><Button size="sm" variant="outline" className="gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Manage routers</Button></Link></div>
        </CardContent>
      </Card>
    </div>
  );
}

export function CustomerPortalPanel() {
  return (
    <div className="space-y-6">
      <div className="mb-2"><h2 className="text-base font-semibold">Customer Portal</h2><p className="text-xs text-muted-foreground mt-0.5">The self-service app your customers use to buy packages, redeem vouchers, and check their account.</p></div>
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Wifi className="w-4 h-4" />What's live</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-xs text-muted-foreground">
          <p>• OTP-based sign-in by phone number (no passwords)</p>
          <p>• Package purchase via M-PESA STK push, with automatic device sign-on</p>
          <p>• Voucher redemption and "already paid?" recovery by receipt code</p>
          <p>• Wallet balance and Loyalty points (Loyalty page)</p>
          <p className="pt-2 text-foreground">Per-tenant customization (custom copy, disabling specific self-serve flows, custom domain) isn't configurable from here yet — it's the same experience for every tenant today.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function AuthenticationPanel() {
  return (
    <div className="space-y-6">
      <div className="mb-2"><h2 className="text-base font-semibold">Authentication</h2><p className="text-xs text-muted-foreground mt-0.5">How staff and customers sign in.</p></div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Staff</CardTitle></CardHeader>
        <CardContent className="space-y-1"><StatRow label="Method" value="Email + password" /><StatRow label="New staff" value="Requires approval before first login" /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Customers</CardTitle></CardHeader>
        <CardContent className="space-y-1"><StatRow label="Method" value="SMS one-time code (OTP), no password" /><StatRow label="Also supported" value="Account-number reconnect from the captive portal" /></CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">These are fixed policies today, not yet configurable per tenant (e.g. OTP code length/expiry, session duration).</p>
    </div>
  );
}

const ROLE_INFO: Array<{ role: string; description: string }> = [
  { role: "Super Admin", description: "Full access, including tenant and payment/SMS gateway configuration" },
  { role: "Business Owner", description: "Same operational access as Super Admin; typically the tenant's primary owner" },
  { role: "Staff", description: "Day-to-day operations: customers, subscriptions, vouchers, NOC actions" },
  { role: "Technician", description: "Network operations focus: routers, sessions, NOC — limited billing access" },
  { role: "Reseller", description: "Manages their own customer/subscription book; no infrastructure access" },
];

export function SecurityPanel() {
  return (
    <div className="space-y-6">
      <div className="mb-2"><h2 className="text-base font-semibold">Security</h2><p className="text-xs text-muted-foreground mt-0.5">Roles and what they can do.</p></div>
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Staff roles</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {ROLE_INFO.map((r) => (
            <div key={r.role} className="flex gap-3 text-xs py-1 border-b border-border last:border-0">
              <Badge variant="outline" className="shrink-0 w-32 justify-center">{r.role}</Badge>
              <span className="text-muted-foreground">{r.description}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6"><p className="text-xs text-muted-foreground">Secrets (router API passwords, M-PESA/SMS credentials) are encrypted at rest and never returned to the browser after saving — settings forms show "set" instead of the actual value. Manage individual staff accounts and their roles on the <Link href="/users" className="text-primary hover:underline">Users</Link> page.</p></CardContent>
      </Card>
    </div>
  );
}

export function BillingPanel() {
  return (
    <div className="space-y-6">
      <div className="mb-2"><h2 className="text-base font-semibold">Billing</h2><p className="text-xs text-muted-foreground mt-0.5">Invoices, payments, and revenue.</p></div>
      <Card>
        <CardContent className="pt-6 space-y-3">
          <p className="text-xs text-muted-foreground">Invoice generation, payment recording, and revenue reporting are managed on their own pages — there's no separate tenant-level billing configuration (tax rate, invoice numbering format, etc.) yet.</p>
          <div className="flex gap-2">
            <Link href="/invoices"><Button size="sm" variant="outline" className="gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Invoices</Button></Link>
            <Link href="/subscriptions"><Button size="sm" variant="outline" className="gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Subscriptions</Button></Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function SystemPanel() {
  const info = useQuery({ queryKey: ["settings", "system"], queryFn: getSystemInfo });
  return (
    <div className="space-y-6">
      <div className="mb-2"><h2 className="text-base font-semibold flex items-center gap-2"><Cpu className="w-4 h-4" />System</h2><p className="text-xs text-muted-foreground mt-0.5">Read-only operational snapshot — there's no in-app system configuration (that lives in deployment env vars).</p></div>
      <Card>
        <CardContent className="pt-6 space-y-1">
          <StatRow label="Environment" value={info.data?.environment ?? "—"} />
          <StatRow label="Routers" value={info.data?.counts.routers ?? "—"} />
          <StatRow label="Active subscriptions" value={info.data?.counts.activeSubscriptions ?? "—"} />
          <StatRow label="Active staff" value={info.data?.counts.activeStaff ?? "—"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Integration readiness</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <StatusRow label="M-PESA (deployment-wide env vars)" ok={!!info.data?.mpesaEnvVarsConfigured} />
          <StatusRow label="SMS gateway (deployment-wide env vars)" ok={!!info.data?.smsConfigured} />
          <StatusRow label="AI narrative (ANTHROPIC_API_KEY)" ok={!!info.data?.llmNarrativeConfigured} />
        </CardContent>
      </Card>
    </div>
  );
}
