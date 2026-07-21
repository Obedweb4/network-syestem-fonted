import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { useLocation, useSearch } from "wouter";
import {
  Building2, Palette, CreditCard, Bell, Sparkles, Router as RouterIcon, Wifi,
  ShieldCheck, Lock, Receipt, Star, Wallet, DatabaseBackup, Plug, Cpu, Settings as SettingsIcon,
} from "lucide-react";
import { GeneralPanel, TenantInformationPanel, BrandingPanel } from "@/components/settings/TenantPanels";
import { PaymentMethodsPanel } from "@/components/settings/PaymentMethodsPanel";
import { NotificationsPanel } from "@/components/settings/NotificationsPanel";
import { NocSettingsPanel } from "@/components/settings/NocSettingsPanel";
import { RoutersPanel, CustomerPortalPanel, AuthenticationPanel, SecurityPanel, BillingPanel, SystemPanel } from "@/components/settings/InfoPanels";
import { LoyaltyPanel } from "@/components/settings/LoyaltyPanel";
import { ComingSoon } from "@/components/settings/ComingSoon";

type SectionId =
  | "general" | "tenant" | "branding" | "payment-methods" | "notifications" | "ai-noc"
  | "routers" | "customer-portal" | "authentication" | "security" | "billing"
  | "loyalty" | "wallet" | "backup" | "integrations" | "system";

const NAV: Array<{ id: SectionId; label: string; icon: typeof Building2 }> = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "tenant", label: "Tenant Information", icon: Building2 },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "payment-methods", label: "Payment Methods", icon: CreditCard },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "ai-noc", label: "AI NOC", icon: Sparkles },
  { id: "routers", label: "Routers", icon: RouterIcon },
  { id: "customer-portal", label: "Customer Portal", icon: Wifi },
  { id: "authentication", label: "Authentication", icon: Lock },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "billing", label: "Billing", icon: Receipt },
  { id: "loyalty", label: "Loyalty Points", icon: Star },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "backup", label: "Backup & Restore", icon: DatabaseBackup },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "system", label: "System", icon: Cpu },
];

// Only these two are pure "not built yet" placeholders — everything else
// on this page is wired to something real (even if some of what's real is
// read-only informational data rather than an editable form).
const NOT_YET_AVAILABLE: Partial<Record<SectionId, string>> = {
  backup: "Database backup/restore isn't available from the dashboard yet. Until then, back up at the infrastructure level (e.g. your Postgres provider's own snapshot/backup tooling) — this is not something to trigger from the app itself without real safeguards (retention policy, restore testing, access control) behind it.",
  integrations: "No third-party integrations (accounting software, CRM, etc.) are wired up yet. This section is a placeholder for when that's scoped.",
};

export default function SettingsPage() {
  const { user } = useAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const section = (new URLSearchParams(search).get("section") ?? "general") as SectionId;
  const isAdmin = (user?.roles ?? []).some((r) => ["super_admin", "business_owner"].includes(r.toLowerCase()));

  function go(id: SectionId) {
    setLocation(`/settings?section=${id}`);
  }

  function renderSection() {
    if (NOT_YET_AVAILABLE[section]) return <ComingSoon message={NOT_YET_AVAILABLE[section]!} />;
    switch (section) {
      case "general": return <GeneralPanel isAdmin={isAdmin} />;
      case "tenant": return <TenantInformationPanel isAdmin={isAdmin} />;
      case "branding": return <BrandingPanel isAdmin={isAdmin} />;
      case "payment-methods": return <PaymentMethodsPanel isAdmin={isAdmin} />;
      case "notifications": return <NotificationsPanel isAdmin={isAdmin} />;
      case "ai-noc": return <NocSettingsPanel isAdmin={isAdmin} />;
      case "routers": return <RoutersPanel />;
      case "customer-portal": return <CustomerPortalPanel />;
      case "authentication": return <AuthenticationPanel />;
      case "security": return <SecurityPanel />;
      case "billing": return <BillingPanel />;
      case "loyalty": return <LoyaltyPanel focus="loyalty" isAdmin={isAdmin} />;
      case "wallet": return <LoyaltyPanel focus="wallet" isAdmin={isAdmin} />;
      case "system": return <SystemPanel />;
      default: return <GeneralPanel isAdmin={isAdmin} />;
    }
  }

  return (
    <AppLayout>
      <div className="flex h-full">
        <nav className="w-56 shrink-0 border-r border-border p-3 space-y-0.5 overflow-y-auto">
          <h1 className="px-2 pb-2 text-sm font-bold">Settings</h1>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors ${active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
          {renderSection()}
        </div>
      </div>
    </AppLayout>
  );
}
