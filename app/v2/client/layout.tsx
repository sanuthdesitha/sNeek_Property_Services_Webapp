"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  useAttentionCounts,
  withAttentionBadges,
} from "@/components/v2/portal/use-attention-counts";
import {
  Boxes,
  Briefcase,
  Building2,
  CalendarPlus,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Gift,
  Home,
  MessageSquare,
  PackageSearch,
  Settings,
  Shirt,
  ShoppingCart,
  UserRound,
  Wallet,
  Wrench,
} from "lucide-react";

/**
 * Client nav — every destination is listed and grouped under a small heading.
 *
 * There is no "More" catch-all any more: it sat mid-list, hid a dozen real
 * destinations behind an extra tap, and meant the rail's order didn't reflect
 * how the portal is actually used. "Services" is gone too — it was the jobs
 * list under another name (that route now redirects to /jobs).
 *
 * PortalShell renders nav.slice(0,5) as the mobile bottom tabs, so the first
 * five are deliberately the daily destinations — Home, Jobs, Laundry,
 * Approvals, Reports. Everything else is one tap away in the mobile drawer and
 * always visible on the desktop rail.
 */
function buildNav(): NavItem[] {
  return [
    { href: "/v2/client", label: "Home", icon: Home, group: "Overview" },
    // Bottom-bar four (after Home) — the daily flow.
    { href: "/v2/client/jobs", label: "Jobs", icon: Briefcase, group: "Your cleans" },
    { href: "/v2/client/laundry", label: "Laundry", icon: Shirt, group: "Your cleans" },
    {
      href: "/v2/client/approvals",
      label: "Approvals",
      icon: ClipboardCheck,
      group: "Your cleans",
    },
    { href: "/v2/client/reports", label: "Reports", icon: FileText, group: "Your cleans" },
    { href: "/v2/client/calendar", label: "Calendar", icon: CalendarRange, group: "Your cleans" },
    { href: "/v2/client/booking", label: "Book a clean", icon: CalendarPlus, group: "Your cleans" },

    { href: "/v2/client/properties", label: "Properties", icon: Building2, group: "Your homes" },
    { href: "/v2/client/inventory", label: "Inventory", icon: Boxes, group: "Your homes" },
    { href: "/v2/client/shopping", label: "Shopping", icon: ShoppingCart, group: "Your homes" },
    { href: "/v2/client/stock-runs", label: "Stock runs", icon: PackageSearch, group: "Your homes" },

    // Disputes are handled inside the cases workspace (its own heading reads
    // "Cases & disputes"), and /v2/client/disputes is a bare redirect to this
    // very page — so the second nav item cost a round trip to land exactly
    // where the first one already goes. The redirect route stays for bookmarks.
    { href: "/v2/client/cases", label: "Cases & disputes", icon: ClipboardList, group: "Support" },
    { href: "/v2/client/maintenance", label: "Maintenance", icon: Wrench, group: "Support" },
    { href: "/v2/client/messages", label: "Messages", icon: MessageSquare, group: "Support" },

    { href: "/v2/client/money", label: "Money", icon: Wallet, group: "Billing" },
    { href: "/v2/client/quotes", label: "Quotes", icon: FileSpreadsheet, group: "Billing" },

    { href: "/v2/client/referrals", label: "Referrals", icon: Gift, group: "Account" },
    { href: "/v2/client/profile", label: "Profile", icon: UserRound, group: "Account" },
    { href: "/v2/client/settings", label: "Settings", icon: Settings, group: "Account" },
  ];
}

export default function V2ClientLayout({ children }: { children: React.ReactNode }) {
  // Everything waiting on this client, not just approvals: a case asking them
  // a question, a quote to decide, an invoice to pay. Each count is "waiting
  // on YOU" rather than "exists" — see the route for each definition.
  const counts = useAttentionCounts("/api/client/attention-counts");
  const nav = React.useMemo(() => withAttentionBadges(buildNav(), counts), [counts]);

  return (
    <div data-skin="estate" data-portal-accent="client">
      <PortalShell accent="client" wordmark="sNeek" nav={nav} roleLabel="Client">
        {children}
      </PortalShell>
    </div>
  );
}
