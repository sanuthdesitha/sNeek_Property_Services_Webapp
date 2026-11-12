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
  Map, Wrench, Sparkles, ClipboardList, FileText,
  Tags, Truck, Eye, UserCircle, Bell, MessageSquare,
} from "lucide-react";

// The rail follows the approved design: Today, Operations, People and quality,
// Money, Setup, then the rarely used system tools. One entry per destination:
// pages that are now tabs of another page (Clients, Cleaners, Workforce,
// Coaching, Pricing) are reached from that page and keep their old URLs.
const NAV: NavItem[] = [
  { href: "/v2/admin", label: "Command", icon: LayoutDashboard, group: "Today" },
  { href: "/v2/admin/jobs", label: "Jobs", icon: Briefcase, group: "Today" },
  { href: "/v2/admin/calendar", label: "Calendar", icon: CalendarRange, group: "Today" },
  { href: "/v2/admin/ops", label: "Live ops", icon: Map, group: "Today" },
  { href: "/v2/admin/approvals", label: "Approvals", icon: Inbox, group: "Today" },
  { href: "/v2/admin/messages", label: "Messages", icon: MessageSquare, group: "Today" },

  { href: "/v2/admin/cases", label: "Cases", icon: ClipboardCheck, group: "Operations" },
  { href: "/v2/admin/laundry", label: "Laundry", icon: Shirt, group: "Operations" },
  { href: "/v2/admin/lost-found", label: "Lost and found", icon: PackageSearch, group: "Operations" },
  { href: "/v2/admin/inventory", label: "Stock", icon: Boxes, group: "Operations" },
  { href: "/v2/admin/suppliers", label: "Suppliers", icon: Truck, group: "Operations" },
  { href: "/v2/admin/properties", label: "Properties", icon: Building2, group: "Operations" },
  { href: "/v2/admin/onboarding", label: "Property onboarding", icon: ClipboardList, group: "Operations" },
  { href: "/v2/admin/maintenance", label: "Maintenance", icon: Wrench, group: "Operations" },

  // One People page (clients, cleaners, office staff, partners, assistants,
  // invitations) and one Quality hub (review queue, issues, cleaners,
  // inspectors, categories, coaching). Reports is now Insights (same route).
  { href: "/v2/admin/accounts", label: "People", icon: Users, group: "People and quality" },
  { href: "/v2/admin/hiring", label: "Hiring", icon: GraduationCap, group: "People and quality" },
  { href: "/v2/admin/quality", label: "Quality", icon: ShieldCheck, group: "People and quality" },
  { href: "/v2/admin/reports", label: "Insights", icon: FileText, group: "People and quality" },

  { href: "/v2/admin/finance", label: "Invoices and pay", icon: Wallet, group: "Money" },
  { href: "/v2/admin/quotes", label: "Quotes and pricing", icon: Tags, group: "Money" },
  { href: "/v2/admin/growth", label: "Growth", icon: Megaphone, group: "Money" },

  { href: "/v2/admin/forms", label: "Forms", icon: ClipboardList, group: "Setup" },
  { href: "/v2/admin/notifications", label: "Notifications", icon: Bell, group: "Setup" },
  { href: "/v2/admin/settings", label: "Settings", icon: Settings, group: "Setup" },
  { href: "/v2/admin/activity", label: "Activity log", icon: Activity, group: "Setup", adminOnly: true },

  { href: "/v2/admin/profile", label: "My profile", icon: UserCircle, group: "System" },
  { href: "/v2/admin/delivery-profiles", label: "Delivery profiles", icon: Truck, group: "System" },
  { href: "/v2/admin/ai", label: "AI configuration", icon: Sparkles, group: "System" },
  { href: "/v2/admin/system/test-as", label: "Test as", icon: Eye, group: "System", adminOnly: true },
  { href: "/v2/admin/diagnostics", label: "Diagnostics", icon: ShieldCheck, group: "System", adminOnly: true },
];

// Which attention count badges which nav item. Pages without an unambiguous
// pending queue (Calendar, Properties, Settings, …) deliberately have no badge —
// see lib/admin/attention-counts.ts for each count's definition.
const COUNT_KEY_BY_HREF: Record<string, keyof AdminAttentionCounts> = {
  "/v2/admin/jobs": "jobs",
  "/v2/admin/approvals": "approvals",
  // Unclaimed inspections + QA issues awaiting rectification.
  "/v2/admin/quality": "qualityHub",
  "/v2/admin/cases": "cases",
  "/v2/admin/lost-found": "lostFound",
  "/v2/admin/laundry": "laundry",
  // Client invoices to send (draft or approved) + cleaner invoices awaiting the office.
  "/v2/admin/finance": "finance",
  "/v2/admin/growth": "growth",
  // Urgent stock needs awaiting acknowledgement (null for non-administrators).
  "/v2/admin/inventory": "urgentStock",
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
        const badge = (key && counts ? counts[key] : 0) ?? 0;
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
