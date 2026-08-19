"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  useClientPortalCounts,
  withAttentionBadges,
  type ClientPortalGate,
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
  Users,
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
/**
 * What a VA may be OFFERED, by destination.
 *
 * "client" = never shown to a VA (money decisions, account management, and
 * modules with no grant key). A permission name = shown only with that grant.
 * "always" = any active VA (the pages themselves still enforce, this only
 * avoids offering a tap that would refuse). Destinations missing from this map
 * default to client-only, so a NEW nav item is hidden from VAs until someone
 * decides otherwise — fail closed, not fail visible.
 */
const VA_NAV_GATE: Record<string, "always" | "client" | string> = {
  "/v2/client": "always",
  "/v2/client/jobs": "always",
  "/v2/client/laundry": "always",
  "/v2/client/calendar": "always",
  "/v2/client/booking": "bookings",
  "/v2/client/reports": "reports",
  "/v2/client/properties": "properties",
  "/v2/client/inventory": "properties",
  "/v2/client/cases": "maintenance",
  "/v2/client/maintenance": "maintenance",
  "/v2/client/messages": "messages",
  "/v2/client/money": "invoicesView",
  "/v2/client/approvals": "client",
  "/v2/client/quotes": "client",
  "/v2/client/shopping": "client",
  "/v2/client/stock-runs": "client",
  "/v2/client/referrals": "client",
  "/v2/client/profile": "client",
  "/v2/client/settings": "client",
  "/v2/client/team": "client",
};

function filterNavForVa(nav: NavItem[], gate: ClientPortalGate | null): NavItem[] {
  return nav.filter((item) => {
    const rule = VA_NAV_GATE[item.href] ?? "client";
    if (rule === "always") return true;
    if (rule === "client") return false;
    // Grants arrive with the first counts poll; until then only the
    // always-set shows, which then EXPANDS — better than offering taps that
    // bounce and then vanish.
    return gate?.permissions?.[rule] === true;
  });
}

function buildNav(canManageTeam: boolean): NavItem[] {
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
    // Managing assistants is the client's own power and is not delegable, so a
    // VA signed into this same portal must not even see the destination. The
    // page and every endpoint refuse them too; this only avoids offering a tap
    // that would 403.
    ...(canManageTeam
      ? [{ href: "/v2/client/team", label: "Assistants", icon: Users, group: "Account" } as NavItem]
      : []),
    { href: "/v2/client/settings", label: "Settings", icon: Settings, group: "Account" },
  ];
}

export default function V2ClientLayout({ children }: { children: React.ReactNode }) {
  // Everything waiting on this client, not just approvals: a case asking them
  // a question, a quote to decide, an invoice to pay. Each count is "waiting
  // on YOU" rather than "exists" — see the route for each definition.
  const { counts, gate } = useClientPortalCounts("/api/client/attention-counts");
  // Both CLIENT and VA render this portal; only the client manages assistants,
  // and a VA is only OFFERED destinations their grants can actually open.
  const { data: session } = useSession();
  const isVa = session?.user?.role === "VA";
  const canManageTeam = session?.user?.role === "CLIENT";
  const nav = React.useMemo(() => {
    const base = buildNav(canManageTeam);
    return withAttentionBadges(isVa ? filterNavForVa(base, gate) : base, counts);
  }, [counts, canManageTeam, isVa, gate]);

  // An assistant sees their OWN name in the rail (PortalShell reads the
  // session) with the client they act for underneath. Labelling them "Client"
  // was the portal pretending to be someone it is not, and a VA who works
  // across several clients had nothing on screen telling them which account
  // they were about to change.
  const roleLabel = isVa
    ? gate?.actingFor
      ? "Assistant · " + gate.actingFor
      : "Assistant"
    : "Client";

  return (
    <div
      data-skin="estate"
      data-portal-accent="client"
      data-portal-actor={isVa ? "va" : "client"}
    >
      <PortalShell accent="client" wordmark="sNeek" nav={nav} roleLabel={roleLabel}>
        {isVa ? <VaActingBanner name={session?.user?.name} gate={gate} /> : null}
        {children}
      </PortalShell>
    </div>
  );
}

/**
 * Standing reminder of whose account this is.
 *
 * It renders on every page rather than only on the home screen because the
 * risk it addresses is not "where am I when I arrive" — it is a VA switching
 * accounts mid-task and cancelling the wrong clean. The last line states the
 * one rule that is never delegable, so nobody has to discover it by being
 * refused.
 */
function VaActingBanner({
  name,
  gate,
}: {
  name?: string | null;
  gate: ClientPortalGate | null;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2 text-[0.8125rem]">
      <span className="font-medium text-[hsl(var(--e-foreground))]">{name || "Assistant"}</span>
      <span className="text-[hsl(var(--e-muted-foreground))]">
        {gate?.actingFor
          ? "is working in " + gate.actingFor + "’s account"
          : "is working on behalf of a client"}
        {gate?.teamName ? " · " + gate.teamName : ""}
      </span>
      <span className="ml-auto text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Approvals and payments stay with the client
      </span>
    </div>
  );
}
