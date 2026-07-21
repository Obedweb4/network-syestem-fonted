import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, Wifi, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { canSee, ChevronDown, logoutItem, navigation, type NavItem } from "./navigation";
import { cn } from "@/lib/utils";

function isActive(item: NavItem, location: string): boolean {
  return Boolean(item.href && (item.href === "/" ? location === "/" : location === item.href.split("?")[0] || location.startsWith(`${item.href.split("?")[0]}/`))) || Boolean(item.children?.some((child) => isActive(child, location)));
}

function NavigationList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const [location] = useLocation();
  const { user, clearAuth } = useAuth();
  const [expanded, setExpanded] = useState<string | null>(() => navigation.find((item) => isActive(item, location))?.label ?? null);
  const visible = navigation.filter((item) => canSee(item, user?.roles));
  const navigate = () => onNavigate?.();
  const LogoutIcon = logoutItem.icon;
  return <nav aria-label="Primary navigation" className="space-y-1 px-2 py-3">
    {visible.map((item) => {
      const Icon = item.icon; const active = isActive(item, location); const open = expanded === item.label;
      if (item.children) return <div key={item.label}>
        <button type="button" onClick={() => setExpanded(open ? null : item.label)} aria-expanded={open}
          className={cn("nav-item w-full", active && "nav-item-active", collapsed && "justify-center px-2")} title={collapsed ? item.label : undefined}>
          <Icon className="h-5 w-5 shrink-0" /> {!collapsed && <><span className="flex-1 text-left">{item.label}</span><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /></>}
        </button>
        {!collapsed && open && <div className="ml-4 mt-1 space-y-1 border-l border-border pl-2">{item.children.filter((child) => canSee(child, user?.roles)).map((child) => {
          const ChildIcon = child.icon; return <Link key={child.label} href={child.href!} onClick={navigate} className={cn("nav-item nav-child", isActive(child, location) && "nav-item-active")}><ChildIcon className="h-4 w-4" /><span>{child.label}</span></Link>;
        })}</div>}
      </div>;
      return <Link key={item.label} href={item.href!} onClick={navigate} className={cn("nav-item", active && "nav-item-active", collapsed && "justify-center px-2")} title={collapsed ? item.label : undefined}><Icon className="h-5 w-5 shrink-0" />{!collapsed && <span>{item.label}</span>}</Link>;
    })}
    <div className="mt-4 border-t border-border pt-3"><button type="button" onClick={clearAuth} className={cn("nav-item w-full text-destructive hover:bg-destructive/10", collapsed && "justify-center px-2")} title={collapsed ? logoutItem.label : undefined}><LogoutIcon className="h-5 w-5" />{!collapsed && logoutItem.label}</button></div>
  </nav>;
}

export function Sidebar({ mobileOpen, onMobileClose }: { mobileOpen: boolean; onMobileClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onMobileClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    drawerRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keydown); };
  }, [mobileOpen, onMobileClose]);
  const brand = <div className="flex h-16 items-center gap-3 px-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Wifi className="h-5 w-5" /></span>{!collapsed && <span className="font-semibold tracking-tight">PulseNet <span className="text-orange-400">Billing</span></span>}</div>;
  return <>
    <aside className={cn("hidden shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 lg:flex lg:flex-col", collapsed ? "w-[72px]" : "w-64")}>
      {brand}<NavigationList collapsed={collapsed} /><button type="button" onClick={() => setCollapsed(!collapsed)} className="m-3 mt-auto flex min-h-11 items-center justify-center rounded-lg text-sidebar-foreground/70 hover:bg-white/10 hover:text-white" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}><Menu className="h-5 w-5" /></button>
    </aside>
    <div className={cn("fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm transition-opacity lg:hidden", mobileOpen ? "opacity-100" : "pointer-events-none opacity-0")} onMouseDown={onMobileClose} aria-hidden="true" />
    <aside ref={drawerRef} role="dialog" aria-modal="true" aria-label="Navigation menu" className={cn("fixed inset-y-0 left-0 z-50 flex w-[min(86vw,340px)] flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ease-out lg:hidden", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex items-center justify-between">{brand}<button type="button" onClick={onMobileClose} aria-label="Close menu" className="mr-3 grid h-11 w-11 place-items-center rounded-lg hover:bg-white/10"><X className="h-5 w-5" /></button></div><NavigationList onNavigate={onMobileClose} />
    </aside>
  </>;
}
