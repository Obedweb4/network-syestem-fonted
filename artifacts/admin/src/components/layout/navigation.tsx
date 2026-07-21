import type { ComponentType } from "react";
import {
  Antenna, Bell, BrainCircuit, ChartNoAxesCombined, ChevronDown, CreditCard, FileText,
  Gauge, LayoutDashboard, LogOut, Network, Radio, ReceiptText, Router, ScrollText,
  Settings, ShieldCheck, Signal, Ticket, UserCheck, Users, Wallet, Wifi, Zap,
} from "lucide-react";

export type NavItem = {
  label: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  roles?: string[];
  children?: NavItem[];
};

export const navigation: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Customers", icon: Users, children: [
    { label: "All Customers", href: "/customers", icon: Users },
    { label: "New Customer", href: "/customers?new=1", icon: Users },
    { label: "Customer Groups", href: "/customers?view=groups", icon: Users },
  ] },
  { label: "Internet Services", icon: Wifi, children: [
    { label: "Hotspot", href: "/plans?type=HOTSPOT", icon: Radio },
    { label: "PPPoE", href: "/plans?type=PPPOE", icon: Signal },
    { label: "Vouchers", href: "/vouchers", icon: Ticket },
    { label: "Packages", href: "/plans", icon: Zap },
  ] },
  { label: "Billing", icon: ReceiptText, children: [
    { label: "Invoices", href: "/invoices", icon: FileText },
    { label: "Payments", href: "/invoices?view=payments", icon: CreditCard },
    { label: "Wallet", href: "/invoices?view=wallet", icon: Wallet },
    { label: "Loyalty Points", href: "/settings?section=loyalty", icon: Ticket },
  ] },
  { label: "Network", icon: Network, roles: ["super_admin", "business_owner", "staff", "technician"], children: [
    { label: "Routers", href: "/routers", icon: Router },
    { label: "Network Monitor", href: "/network-monitor", icon: Gauge },
    { label: "Traffic", href: "/network-monitor?view=traffic", icon: ChartNoAxesCombined },
    { label: "Logs", href: "/network-monitor?view=logs", icon: FileText },
  ] },
  { label: "AI NOC", href: "/network-monitor?view=ai", icon: BrainCircuit, roles: ["super_admin", "business_owner", "staff", "technician"] },
  { label: "RADIUS", icon: Antenna, roles: ["super_admin", "business_owner", "staff", "technician"], children: [
    { label: "Overview", href: "/radius", icon: Gauge },
    { label: "Online Users", href: "/radius?view=online", icon: Users },
    { label: "Auth Events", href: "/radius?view=events", icon: ScrollText },
  ] },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Reports", href: "/invoices?view=reports", icon: ChartNoAxesCombined, roles: ["super_admin", "business_owner", "staff", "reseller"] },
  { label: "Users", href: "/users", icon: ShieldCheck, roles: ["super_admin", "business_owner"] },
  { label: "Pending Approvals", href: "/pending-approvals", icon: UserCheck, roles: ["super_admin", "business_owner"] },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["super_admin", "business_owner"] },
];

export function canSee(item: NavItem, roles: string[] = []) {
  return !item.roles || roles.some((role) => item.roles!.includes(role.toLowerCase()));
}

export const logoutItem = { label: "Logout", icon: LogOut };
export { ChevronDown };
