"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import type { AdminAttentionCounts } from "@/lib/admin/attention-counts";
import {
  LayoutDashboard,
  Briefcase,
  CalendarRange,
  Inbox,
  Building2,
  ShieldCheck,
  ShieldAlert,
  Trophy,
  Activity,
  ClipboardCheck,
  Shirt,
  Users,
  Wallet,
  Boxes,
  Megaphone,
  Settings,
  PackageSearch,
  GraduationCap,
  UsersRound,
  Map, Wrench, Sparkles, ClipboardList, ReceiptText, FileText,
  Tags, Truck, ListChecks, Eye, UserCircle,
} from "lucide-react";

const NAV: NavItem[] = [
  { href: "/v2/admin", label: "Command", icon: LayoutDashboard, group: "Daily work" },
  { href: "/v2/admin/jobs", label: "Jobs", icon: Briefcase, group: "Daily work" },
  { href: "/v2/admin/calendar", label: "Calendar", icon: CalendarRange, group: "Daily work" },
  { href: "/v2/admin/approvals", label: "Approvals", icon: Inbox, group: "Daily work" },
  { href: "/v2/admin/properties", label: "Properties", icon: Building2, group: "Daily work" },

  { href: "/v2/admin/ops", label: "Live ops", icon: Map, group: "Operations" },
  { href: "/v2/admin/cases", label: "Cases", icon: ClipboardCheck, group: "Operations" },
  { href: "/v2/admin/maintenance", label: "Maintenance", icon: Wrench, group: "Operations" },
  { href: "/v2/admin/lost-found", label: "Lost & found", icon: PackageSearch, group: "Operations" },
  { href: "/v2/admin/laundry", label: "Laundry", icon: Shirt, group: "Operations" },
  { href: "/v2/admin/inventory", label: "Inventory", icon: Boxes, group: "Operations" },

  { href: "/v2/admin/accounts", label: "Accounts", icon: Users, group: "People & property" },
  { href: "/v2/admin/clients", label: "Clients", icon: Users, group: "People & property" },
  { href: "/v2/admin/cleaners", label: "Cleaners", icon: Sparkles, group: "People & property" },
  { href: "/v2/admin/workforce", label: "Workforce", icon: UsersRound, group: "People & property" },
  { href: "/v2/admin/workforce/coaching", label: "Coaching", icon: GraduationCap, group: "People & property" },
  { href: "/v2/admin/onboarding", label: "Property onboarding", icon: ClipboardList, group: "People & property" },
  { href: "/v2/admin/hiring", label: "Hiring", icon: Briefcase, group: "People & property" },

  { href: "/v2/admin/quality", label: "Quality", icon: ShieldCheck, group: "Quality" },
  { href: "/v2/admin/quality/issues", label: "QA Issues", icon: ShieldAlert, group: "Quality" },
  { href: "/v2/admin/quality/accountability", label: "Accountability", icon: Trophy, group: "Quality" },
  { href: "/v2/admin/quality/qa-performance", label: "QA Performance", icon: Activity, group: "Quality" },
  { href: "/v2/admin/reports", label: "Reports", icon: FileText, group: "Quality" },

  { href: "/v2/admin/finance", label: "Finance", icon: Wallet, group: "Commercial" },
  { href: "/v2/admin/payroll", label: "Payroll", icon: Wallet, group: "Commercial" },
  { href: "/v2/admin/cleaner-invoices", label: "Cleaner invoices", icon: ReceiptText, group: "Commercial" },
  { href: "/v2/admin/growth", label: "Growth", icon: Megaphone, group: "Commercial" },
  { href: "/v2/admin/quotes", label: "Quotes & leads", icon: FileText, group: "Commercial" },
  { href: "/v2/admin/pricing", label: "Pricing", icon: Tags, group: "Commercial" },
  { href: "/v2/admin/delivery-profiles", label: "Delivery profiles", icon: Truck, group: "Commercial" },

  { href: "/v2/admin/settings", label: "Settings", icon: Settings, group: "Configuration" },
  { href: "/v2/admin/ai", label: "AI configuration", icon: Sparkles, group: "Configuration" },
  { href: "/v2/admin/checklists", label: "Checklists library", icon: ListChecks, group: "Configuration" },
  { href: "/v2/admin/qa-templates", label: "QA templates", icon: ClipboardCheck, group: "Configuration" },
  { href: "/v2/admin/forms", label: "Forms & stats", icon: ClipboardList, group: "Configuration" },
  { href: "/v2/admin/templates", label: "Templates", icon: FileText, group: "Configuration" },
  { href: "/v2/admin/activity", label: "Activity log", icon: Activity, group: "Configuration" },
  { href: "/v2/admin/system/test-as", label: "Test as", icon: Eye, group: "Configuration" },
  { href: "/v2/admin/profile", label: "My profile", icon: UserCircle, group: "Configuration" },
  { href: "/v2/admin/diagnostics", label: "Diagnostics", icon: ShieldCheck, group: "Configuration" },
];

// Which attention count badges which nav item. Pages without an unambiguous
// pending queue (Calendar, Properties, Settings, …) deliberately have no badge —
// see lib/admin/attention-counts.ts for each count's definition.
const COUNT_KEY_BY_HREF: Record<string, keyof AdminAttentionCounts> = {
  "/v2/admin/jobs": "jobs",
  "/v2/admin/approvals": "approvals",
  "/v2/admin/quality": "quality",
  "/v2/admin/quality/issues": "qaIssues",
  "/v2/admin/cases": "cases",
  "/v2/admin/lost-found": "lostFound",
  "/v2/admin/laundry": "laundry",
  "/v2/admin/finance": "finance",
  "/v2/admin/growth": "growth",
};

const POLL_MS = 60_000;

/**
 * Live attention counts for the rail. Fetches on mount, every 60s, and when
 * the tab regains focus; a failed poll keeps the last known counts rather than
 * flashing badges away.
 */
function useAttentionCounts(): AdminAttentionCounts | null {
  const [counts, setCounts] = React.useState<AdminAttentionCounts | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/admin/nav-attention", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && body?.counts) setCounts(body.counts as AdminAttentionCounts);
      } catch {
        // Keep the previous counts — a blip must not clear real badges.
      }
    };

    void load();
    const interval = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return counts;
}

export default function V2AdminLayout({ children }: { children: React.ReactNode }) {
  const counts = useAttentionCounts();

  const nav = React.useMemo<NavItem[]>(
    () =>
      NAV.map((item) => {
        const key = COUNT_KEY_BY_HREF[item.href];
        const badge = key && counts ? counts[key] : 0;
        return badge > 0 ? { ...item, badge } : item;
      }),
    [counts]
  );

  return (
    <div data-skin="estate" data-portal-accent="admin">
      <PortalShell accent="admin" wordmark="sNeek" nav={nav} roleLabel="Admin">
        {children}
      </PortalShell>
    </div>
  );
}
