import { type ReactNode, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { useAuth } from "@/lib/auth";
import { Redirect, useLocation } from "wouter";
import { Bell, Menu, Search } from "lucide-react";

const TITLES: Record<string, string> = { "/": "Dashboard", "/customers": "Customers", "/subscriptions": "Subscriptions", "/plans": "Packages", "/invoices": "Invoices", "/vouchers": "Vouchers", "/routers": "Routers", "/network-monitor": "Network Monitor", "/radius": "RADIUS", "/notifications": "Notifications", "/users": "Users", "/pending-approvals": "Pending Approvals", "/settings": "Settings" };

export function AppLayout({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const title = useMemo(() => TITLES[location] ?? "PulseNet Billing", [location]);
  if (!token) return <Redirect to="/login" />;
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <main className="min-w-0 flex-1 overflow-auto">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation menu" className="grid h-11 w-11 place-items-center rounded-lg hover:bg-muted lg:hidden"><Menu className="h-5 w-5" /></button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
          <button type="button" aria-label="Search" className="hidden h-11 w-11 place-items-center rounded-lg hover:bg-muted sm:grid"><Search className="h-5 w-5" /></button>
          <button type="button" aria-label="Notifications" className="grid h-11 w-11 place-items-center rounded-lg hover:bg-muted"><Bell className="h-5 w-5" /></button>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground" aria-label="User profile">{`${user?.firstName?.[0] ?? "U"}${user?.lastName?.[0] ?? ""}`}</div>
        </header>
        {children}
      </main>
    </div>
  );
}
