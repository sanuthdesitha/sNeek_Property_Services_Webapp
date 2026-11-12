"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { useAttentionCounts } from "@/components/v2/portal/use-attention-counts";
import { buildTabbedNav } from "@/lib/navigation/tabbed-nav";
import { MAINTENANCE_RAIL, MAINTENANCE_TABS } from "@/components/v2/maintenance/portal/maintenance-nav";

/**
 * Maintenance portal shell (approved board "Maintenance portal", 2026-11).
 *
 * Phone: five tabs — Today, Tickets, Replacements, Log, More. More holds
 * Settings and the account block, so the phone header carries only search and
 * notifications. Desktop: the rail lists every destination.
 */
export default function V2MaintenanceLayout({ children }: { children: React.ReactNode }) {
  // Badges mirror app/v2/maintenance/page.tsx exactly, so a badge can never
  // disagree with the number the page itself prints.
  const counts = useAttentionCounts("/api/maintenance/attention-counts");
  const nav = React.useMemo<NavItem[]>(
    () => buildTabbedNav({ rail: MAINTENANCE_RAIL, tabs: MAINTENANCE_TABS, badges: counts }),
    [counts],
  );

  return (
    <div data-skin="estate" data-portal-accent="maintenance">
      <PortalShell accent="maintenance" wordmark="sNeek" nav={nav} roleLabel="Maintenance" hideMobileMenuButton>
        {children}
      </PortalShell>
    </div>
  );
}
