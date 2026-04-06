"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  DollarSign,
  FileText,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Receipt,
  Search,
  Settings2,
  Shirt,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PortalTheme } from "@/lib/settings";

type PortalNavItem = {
  href: string;
  label: string;
  exact?: boolean;
};

interface PortalShellProps {
  children: React.ReactNode;
  companyName: string;
  logoUrl?: string | null;
  portalLabel: string;
  portalTitle: string;
  navItems: PortalNavItem[];
  settingsHref: string;
  maxWidthClass?: string;
  currentUserName?: string | null;
  currentUserImage?: string | null;
  hideHeaderOnScroll?: boolean;
  portalTheme?: PortalTheme;
}

const NAV_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard:    LayoutDashboard,
  properties:   Building2,
  jobs:         Briefcase,
  booking:      CalendarPlus,
  calendar:     Calendar,
  laundry:      Shirt,
  inventory:    Package,
  shopping:     ShoppingCart,
  "stock-runs": ClipboardList,
  finance:      CreditCard,
  messages:     MessageSquare,
  referrals:    Gift,
  rewards:      Gift,
  reports:      FileText,
  quote:        Receipt,
  quotes:       Receipt,
  approvals:    ClipboardList,
  cases:        AlertTriangle,
  availability: Clock,
  invoices:     Receipt,
  "pay-requests": DollarSign,
  "lost-found": Search,
  hub:          Users,
  settings:     Settings2,
};

function getNavIcon(item: PortalNavItem): React.ComponentType<{ className?: string }> {
  const last = item.href.split("/").filter(Boolean).pop() ?? "";
  return NAV_ICON_MAP[last] ?? NAV_ICON_MAP[item.label.toLowerCase()] ?? LayoutDashboard;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

const COLLAPSED_KEY = "portal-sidebar-collapsed";

export function PortalShell({
  children,
  companyName,
  logoUrl,
  portalLabel,
  navItems,
  settingsHref,
  currentUserName,
  currentUserImage,
  portalTheme = "light",
}: PortalShellProps) {
  const pathname = usePathname();
  const logoInitials = initials(companyName) || "SP";
  const userInitials = initials(currentUserName ?? "") || "U";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeTheme, setActiveTheme] = useState<PortalTheme>(portalTheme);

  useEffect(() => {
    if (localStorage.getItem(COLLAPSED_KEY) === "true") setCollapsed(true);
    const t = localStorage.getItem("portal-theme-override") as PortalTheme | null;
    if (t === "dark" || t === "light" || t === "public") setActiveTheme(t);

    function onStorage(e: StorageEvent) {
      if (e.key === "portal-theme-override") {
        const v = e.newValue as PortalTheme | null;
        if (v === "dark" || v === "light" || v === "public") setActiveTheme(v);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((p) => { const n = !p; localStorage.setItem(COLLAPSED_KEY, String(n)); return n; });
  }, []);

  function handleSignOut() {
    if (typeof window === "undefined") return;
    window.location.assign(`/api/auth/local-signout?callbackUrl=${encodeURIComponent(window.location.origin + "/login")}`);
  }

  function isActive(item: PortalNavItem): boolean {
    return item.exact ? pathname === item.href : pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
  }

  const primaryItems = navItems.slice(0, 5);

  // Sidebar nav link
  function NavLink({ item, compact = false }: { item: PortalNavItem; compact?: boolean }) {
    const active = isActive(item);
    const Icon = getNavIcon(item);
    return (
      <Link
        href={item.href}
        title={compact ? item.label : undefined}
        className={cn(
          "flex items-center rounded-xl px-2.5 py-2.5 text-sm font-medium transition-all duration-150",
          compact ? "justify-center" : "gap-3",
          active
            ? "bg-[hsl(var(--portal-sidebar-active-bg))] text-[hsl(var(--portal-sidebar-active-fg))] shadow-sm"
            : "text-[hsl(var(--portal-sidebar-fg))] hover:bg-muted/20"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!compact && <span className="truncate">{item.label}</span>}
      </Link>
    );
  }

  // Sidebar content (reused for desktop + mobile drawer)
  function SidebarContent({ compact = false }: { compact?: boolean }) {
    return (
      <>
        {/* Header */}
        <div className={cn("flex h-14 items-center border-b border-border/60 shrink-0", compact ? "justify-center" : "gap-3 px-4")}>
          {logoUrl ? (
            <img src={logoUrl} alt={companyName} className="h-8 w-8 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground text-xs font-bold">
              {logoInitials}
            </div>
          )}
          {!compact && (
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--portal-sidebar-fg))]">{portalLabel}</p>
              <p className="truncate text-[10px] text-muted-foreground">{companyName}</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
          {navItems.map((item) => <NavLink key={item.href} item={item} compact={compact} />)}
        </nav>

        {/* Footer */}
        <div className="border-t border-border/60 py-3 px-2 space-y-0.5 shrink-0">
          <Link
            href={settingsHref}
            title={compact ? "Settings" : undefined}
            className={cn("flex items-center rounded-xl px-2.5 py-2.5 text-sm font-medium text-[hsl(var(--portal-sidebar-fg))] hover:bg-muted/20 transition-all duration-150", compact ? "justify-center" : "gap-3")}
          >
            <Settings2 className="h-4 w-4 shrink-0" />
            {!compact && <span>Settings</span>}
          </Link>

          {!compact ? (
            <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
              {currentUserImage ? (
                <img src={currentUserImage} alt={currentUserName ?? ""} className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border" />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                  {userInitials}
                </div>
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{currentUserName ?? "You"}</span>
              <button onClick={handleSignOut} title="Sign out" className="rounded-lg p-1 text-muted-foreground transition-opacity hover:opacity-70">
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button onClick={handleSignOut} title="Sign out" className="flex w-full justify-center rounded-xl px-2.5 py-2.5 text-muted-foreground hover:bg-muted/20 transition-all">
              <LogOut className="h-4 w-4" />
            </button>
          )}

          {!compact && (
            <button
              onClick={toggleCollapsed}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted/20 transition-all"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Collapse</span>
            </button>
          )}
          {compact && (
            <button onClick={toggleCollapsed} title="Expand" className="flex w-full justify-center rounded-xl px-2.5 py-2.5 text-muted-foreground hover:bg-muted/20 transition-all">
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <div
      data-portal-theme={activeTheme}
      className="relative flex min-h-screen overflow-x-hidden bg-background text-foreground"
    >
      {/* ─── DESKTOP SIDEBAR ─── */}
      <aside
        className={cn(
          "portal-sidebar-enter sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border/60 bg-[hsl(var(--portal-sidebar-bg))] overflow-hidden transition-[width] duration-200 md:flex",
          collapsed ? "w-[64px]" : "w-[240px]"
        )}
      >
        <SidebarContent compact={collapsed} />
      </aside>

      {/* ─── MOBILE DRAWER ─── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="portal-sidebar-enter relative z-10 flex h-full w-[260px] shrink-0 flex-col border-r border-border/60 bg-[hsl(var(--portal-sidebar-bg))]">
            <div className="absolute right-3 top-3.5">
              <button onClick={() => setMobileOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--portal-sidebar-fg))] hover:bg-muted/20">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent compact={false} />
          </aside>
        </div>
      )}

      {/* ─── MAIN AREA ─── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-card px-4 sm:px-5">
          <div className="flex items-center gap-3">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </button>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground hidden sm:block">{portalLabel}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-opacity hover:opacity-70" title="Notifications">
              <Bell className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              {currentUserImage ? (
                <img src={currentUserImage} alt={currentUserName ?? ""} className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{userInitials}</div>
              )}
              <span className="hidden max-w-[120px] truncate text-sm font-medium sm:block">{currentUserName ?? "You"}</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="page-fade flex-1 overflow-y-auto p-4 pb-24 sm:p-5 md:p-6 md:pb-6">
          {children}
        </main>
      </div>

      {/* ─── MOBILE BOTTOM TABS ─── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-border/60 bg-card px-2 py-2 md:hidden">
        {primaryItems.map((item) => {
          const active = isActive(item);
          const Icon = getNavIcon(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn("flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 transition-all duration-150", active ? "text-primary" : "text-muted-foreground")}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
        {navItems.length > 5 && (
          <button onClick={() => setMobileOpen(true)} className="flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-muted-foreground">
            <Menu className="h-5 w-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        )}
      </nav>
    </div>
  );
}
