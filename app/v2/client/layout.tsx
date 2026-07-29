"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  Building2,
  CalendarRange,
  ClipboardCheck,
  FileText,
  Home,
  MessageSquare,
  MoreHorizontal,
  Wallet,
} from "lucide-react";

/**
 * Client nav. PortalShell renders nav.slice(0,5) as the mobile bottom tabs and
 * the FULL list as the desktop rail + mobile drawer.
 *
 * The first five are the bottom bar — Home, Services, Approvals, Messages, More.
 * Approvals was promoted out of the More hub because it is the only destination
 * that blocks work (extras must be OK'd before they're done and billed) and the
 * only one carrying a count; "More" now actually appears on the bottom bar
 * instead of being clipped off the end by slice(0,5).
 *
 * Reports, Properties and Money sit after More: always visible on the desktop
 * rail + mobile drawer, and still listed in the /more hub on phones. Everything
 * else (booking, quotes, calendar, laundry, inventory, maintenance, cases,
 * referrals, profile, settings) stays in the More hub — nothing is orphaned.
 */
function buildNav(pendingApprovals: number): NavItem[] {
  return [
    { href: "/v2/client", label: "Home", icon: Home },
    { href: "/v2/client/services", label: "Services", icon: CalendarRange },
    {
      href: "/v2/client/approvals",
      label: "Approvals",
      icon: ClipboardCheck,
      badge: pendingApprovals || undefined,
    },
    { href: "/v2/client/messages", label: "Messages", icon: MessageSquare },
    { href: "/v2/client/more", label: "More", icon: MoreHorizontal },
    // After More → desktop rail + mobile drawer only (not the bottom bar).
    { href: "/v2/client/reports", label: "Reports", icon: FileText },
    { href: "/v2/client/properties", label: "Properties", icon: Building2 },
    { href: "/v2/client/money", label: "Money", icon: Wallet },
  ];
}

/** Pending-approval count for the nav badge; re-read on every navigation. */
function usePendingApprovalCount() {
  const pathname = usePathname();
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/client/approvals", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (cancelled) return;
        setCount(
          Array.isArray(rows) ? rows.filter((row) => row?.status === "PENDING").length : 0
        );
      })
      .catch(() => {
        // A nav badge is never worth surfacing an error for.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return count;
}

export default function V2ClientLayout({ children }: { children: React.ReactNode }) {
  const pendingApprovals = usePendingApprovalCount();
  const nav = React.useMemo(() => buildNav(pendingApprovals), [pendingApprovals]);

  return (
    <div data-skin="estate" data-portal-accent="client">
      <PortalShell accent="client" wordmark="sNeek" nav={nav} roleLabel="Client">
        {children}
      </PortalShell>
    </div>
  );
}
