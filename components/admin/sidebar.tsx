"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Building2,
  Briefcase,
  Calendar,
  FileText,
  AlertTriangle,
  Package,
  Shirt,
  DollarSign,
  HandCoins,
  FileBarChart,
  Bell,
  MessageSquare,
  Settings,
  UserCircle2,
  LogOut,
  MonitorSmartphone,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  SendToBack,
  ShoppingCart,
  Truck,
  BarChart3,
  RefreshCw,
  ClipboardList,
  Wallet,
  Clock3,
  Rocket,
  Zap,
  ClipboardCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export const ADMIN_NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { label: "Ops", href: "/admin/ops", icon: Zap },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Jobs", href: "/admin/jobs", icon: Briefcase },
      { label: "Onboarding", href: "/admin/onboarding", icon: ClipboardCheck },
      { label: "Calendar", href: "/admin/calendar", icon: Calendar },
      { label: "Cases", href: "/admin/cases", icon: AlertTriangle },
      { label: "Laundry", href: "/admin/laundry", icon: Shirt },
      { label: "Inventory", href: "/admin/inventory", icon: Package },
      { label: "Stock Counts", href: "/admin/stock-runs", icon: ClipboardList },
      { label: "Shopping Runs", href: "/admin/shopping-runs", icon: ShoppingCart },
      { label: "Delivery", href: "/admin/delivery-profiles", icon: SendToBack },
      { label: "Suppliers", href: "/admin/suppliers", icon: Truck },
      { label: "Forms", href: "/admin/forms", icon: FileText },
      { label: "Integrations", href: "/admin/integrations", icon: RefreshCw },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Workforce", href: "/admin/workforce", icon: Users },
      { label: "Accounts", href: "/admin/users", icon: Users },
      { label: "Clients", href: "/admin/clients", icon: Users },
      { label: "Properties", href: "/admin/properties", icon: Building2 },
      { label: "Messages", href: "/admin/messages", icon: MessageSquare },
    ],
  },
  {
    label: "Commercial",
    items: [
      { label: "Quotes", href: "/admin/quotes", icon: DollarSign },
      { label: "Approvals", href: "/admin/approvals", icon: CheckCircle2 },
      { label: "Pay Requests", href: "/admin/pay-adjustments", icon: HandCoins },
      { label: "Clock Adjustments", href: "/admin/time-adjustments", icon: Clock3 },
      { label: "Invoices", href: "/admin/invoices", icon: Wallet },
      { label: "Finance", href: "/admin/finance", icon: BarChart3 },
      { label: "Payroll", href: "/admin/payroll", icon: Wallet },
      { label: "Reports", href: "/admin/reports", icon: FileBarChart },
    ],
  },
  {
    label: "Growth",
    items: [
      { label: "Marketing", href: "/admin/marketing", icon: Rocket },
      { label: "Website", href: "/admin/website", icon: MonitorSmartphone },
      { label: "Notifications", href: "/admin/notifications", icon: Bell },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Settings", href: "/admin/settings", icon: Settings },
      { label: "Profile", href: "/admin/profile", icon: UserCircle2 },
    ],
  },
] as const;

interface AdminSidebarProps {
  companyName?: string;
  logoUrl?: string;
  userName?: string | null;
  userImage?: string | null;
  className?: string;
}

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AdminSidebar({
  companyName = "sNeek Property Services",
  logoUrl,
  userName,
  userImage,
  className,
}: AdminSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const initials = initialsFromName(companyName) || "SP";

  return (
    <aside
      className={cn(
        "relative z-20 flex h-screen flex-col border-r border-white/60 bg-white/75 backdrop-blur-md transition-all duration-300",
        collapsed ? "w-16" : "w-60",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_20%_12%,rgba(255,174,87,0.21),transparent_65%),radial-gradient(circle_at_90%_4%,rgba(39,153,163,0.2),transparent_52%)]" />

      {/* Logo */}
      <div className="relative flex items-center gap-3 border-b border-white/70 px-4 py-5">
        {logoUrl ? (
          <img src={logoUrl} alt={`${companyName} logo`} className="h-8 w-8 rounded-lg object-cover bg-white p-0.5 shadow-sm shrink-0" />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
            <span className="text-xs font-bold text-white">{initials}</span>
          </div>
        )}
        {!collapsed && (
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{companyName}</span>
            <span className="block truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Operations
            </span>
          </div>
        )}
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 py-3">
        <AdminNavLinks collapsed={collapsed} />
      </ScrollArea>

      {/* Footer */}
      <div className="space-y-1 border-t border-white/70 p-2">
        {!collapsed ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/70 bg-white/70 px-3 py-2">
            {userImage ? (
              <img src={userImage} alt={userName || "User"} className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <span className="text-xs font-semibold text-primary">{userName?.[0]?.toUpperCase() ?? "A"}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{userName || "Admin"}</p>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Signed in</p>
            </div>
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground hover:bg-white/75"
          onClick={() => {
            const callbackUrl = `${window.location.origin}/login`;
            window.location.assign(`/api/auth/local-signout?callbackUrl=${encodeURIComponent(callbackUrl)}`);
          }}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && "Sign out"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-full hover:bg-white/75"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </aside>
  );
}

// Hrefs that show a live pending count badge
const BADGE_HREFS: Record<string, (counts: Record<string, number>) => number> = {
  "/admin/approvals": (c) => c.total ?? 0,
  "/admin/laundry":   (c) => c.flaggedLaundry ?? 0,
  "/admin/jobs":      (c) => (c.continuations ?? 0) + (c.timingRequests ?? 0),
  "/admin/pay-adjustments": (c) => c.payAdjustments ?? 0,
  "/admin/time-adjustments": (c) => c.timeAdjustments ?? 0,
};

export function AdminNavLinks({
  collapsed = false,
  onNavigate,
}: {
  readonly collapsed?: boolean;
  readonly onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let mounted = true;
    async function fetchCounts() {
      try {
        const res = await fetch("/api/admin/all-approvals");
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (mounted && body?.counts) setCounts(body.counts);
      } catch { /* silent */ }
    }
    fetchCounts();
    const timer = setInterval(fetchCounts, 60_000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  return (
    <nav className="space-y-1 px-2">
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.label} className="space-y-1 pb-3">
          {collapsed ? null : (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
            const badgeCount = BADGE_HREFS[item.href]?.(counts) ?? 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-primary/12 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18)]"
                    : "text-muted-foreground hover:bg-white/75 hover:text-foreground"
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {collapsed ? (
                  badgeCount > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
                      {badgeCount > 9 ? "9+" : badgeCount}
                    </span>
                  )
                ) : (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {badgeCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
