import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ExternalLink, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { getTenant, updateTenant } from "@/lib/settings-api";

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium font-mono">{value}</span>
    </div>
  );
}

export function GeneralPanel({ isAdmin }: { isAdmin: boolean }) {
  const { user } = useAuth();
  const tenant = useQuery({ queryKey: ["settings", "tenant"], queryFn: getTenant });

  return (
    <div className="space-y-6">
      <SectionHeader title="General" description="Your account and a quick overview of this tenant." />
      <Card>
        <CardHeader><CardTitle className="text-sm">Your account</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <ReadOnlyRow label="Name" value={`${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "—"} />
          <ReadOnlyRow label="Email" value={user?.email ?? "—"} />
          <ReadOnlyRow label="Roles" value={user?.roles?.join(", ") ?? "—"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">This tenant</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <ReadOnlyRow label="Name" value={tenant.data?.tenant.name ?? (tenant.isLoading ? "…" : "—")} />
          <ReadOnlyRow label="Tenant ID" value={tenant.data?.tenant.id ?? "—"} />
          <ReadOnlyRow label="Status" value={tenant.data?.tenant.isActive ? "Active" : "Inactive"} />
        </CardContent>
      </Card>
      {!isAdmin && (
        <p className="text-xs text-muted-foreground">Editable settings (tenant info, payment methods, notifications) are visible to Super Admins and Business Owners only.</p>
      )}
    </div>
  );
}

export function TenantInformationPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const tenant = useQuery({ queryKey: ["settings", "tenant"], queryFn: getTenant });
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (tenant.data) setName(tenant.data.tenant.name); }, [tenant.data]);

  async function save() {
    setSaving(true);
    const result = await updateTenant({ name }).catch((err) => { toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }); return null; });
    setSaving(false);
    if (result) { toast({ title: "Tenant information saved" }); qc.invalidateQueries({ queryKey: ["settings", "tenant"] }); }
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Tenant Information" description="Your ISP's identity across the platform." />
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1.5">
            <Label>Business name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} data-testid="input-tenant-name" />
          </div>
          <ReadOnlyRow label="Slug" value={tenant.data?.tenant.slug ?? "—"} />
          <ReadOnlyRow label="Tenant ID" value={tenant.data?.tenant.id ?? "—"} />
          {isAdmin && (
            <Button size="sm" onClick={save} disabled={saving || !name.trim()} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function BrandingPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const tenant = useQuery({ queryKey: ["settings", "tenant"], queryFn: getTenant });
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (tenant.data) setLogoUrl(tenant.data.tenant.logoUrl ?? ""); }, [tenant.data]);

  async function save() {
    setSaving(true);
    const result = await updateTenant({ logoUrl }).catch((err) => { toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }); return null; });
    setSaving(false);
    if (result) { toast({ title: "Branding saved" }); qc.invalidateQueries({ queryKey: ["settings", "tenant"] }); }
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Branding" description="Logo shown across the admin dashboard and customer-facing portal." />
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1.5">
            <Label>Logo URL</Label>
            <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" disabled={!isAdmin} data-testid="input-logo-url" />
          </div>
          {logoUrl && (
            <div className="border border-border rounded-md p-4 flex items-center justify-center bg-muted/30">
              <img src={logoUrl} alt="Logo preview" className="max-h-16 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
          )}
          {isAdmin && (
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </Button>
          )}
          <p className="text-xs text-muted-foreground">More brand controls (colors, custom domain) aren't available yet — logo is the only brandable element today.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export { SectionHeader, ReadOnlyRow };
