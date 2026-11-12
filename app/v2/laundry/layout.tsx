"use client";

import * as React from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { useAttentionCounts, withAttentionBadges } from "@/components/v2/portal/use-attention-counts";
import { LAUNDRY_NAV, LAUNDRY_REQUESTS_PATH, LAUNDRY_TAB_PREFIXES } from "@/components/v2/laundry/portal/laundry-nav";

/**
 * Laundry partner portal shell (board "Laundry partner portal", 2026-11).
 * Phone: five tabs, Today, Runs, Tracking, History, More; the header carries
 * "From the office" with its open count. Desktop: the grouped rail lists every
 * destination. Nav badges mirror each page's own queue definition.
 */
function OfficeInboxLink({ count }: { count: number }) {
  return (
    <Link
      href={LAUNDRY_REQUESTS_PATH}
      aria-label={count ? `From the office, ${count} open` : "From the office"}
      className="relative flex h-11 w-11 items-center justify-center rounded-[10px] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2"
    >
      <Mail className="h-5 w-5" aria-hidden />
      {count ? (
        <span aria-hidden className="absolute right-0.5 top-0.5 min-w-[1.1rem] rounded-full bg-[hsl(var(--e-danger))] px-1 text-center text-[0.625rem] font-semibold leading-[1.1rem] text-white">{count > 9 ? "9+" : count}</span>
      ) : null}
    </Link>
  );
}

export default function V2LaundryLayout({ children }: { children: React.ReactNode }) {
  const counts = useAttentionCounts("/api/laundry/attention-counts");
  const nav = React.useMemo<NavItem[]>(
    () => withAttentionBadges(LAUNDRY_NAV.map((item) => ({ href: item.href, label: item.label, icon: item.icon, group: item.group, mobileOnly: item.mobileOnly, tabActivePrefixes: LAUNDRY_TAB_PREFIXES[item.href] })), counts),
    [counts],
  );

  return (
    <div data-skin="estate" data-portal-accent="laundry" className="max-sm:[&_main_button:not([data-calendar-day])]:min-h-11">
      <PortalShell accent="laundry" wordmark="sNeek" nav={nav} roleLabel="Laundry" hideMobileMenuButton headerActions={<OfficeInboxLink count={counts[LAUNDRY_REQUESTS_PATH] ?? 0} />}>
        {children}
      </PortalShell>
    </div>
  );
}
