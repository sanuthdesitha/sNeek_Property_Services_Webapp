"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  useAttentionCounts,
  withAttentionBadges,
} from "@/components/v2/portal/use-attention-counts";
import { Home, Wrench, Package, ClipboardList, MoreHorizontal } from "lucide-react";

const NAV: NavItem[] = [
  { href: "/v2/maintenance", label: "Today", icon: Home },
  { href: "/v2/maintenance/tickets", label: "Tickets", icon: Wrench },
  { href: "/v2/maintenance/replacements", label: "Replacements", icon: Package },
  { href: "/v2/maintenance/log", label: "Log", icon: ClipboardList },
  { href: "/v2/maintenance/more", label: "More", icon: MoreHorizontal },
];

export default function V2MaintenanceLayout({ children }: { children: React.ReactNode }) {
  // Nav badges mirroring app/v2/maintenance/page.tsx exactly, so a badge can
  // never disagree with the number the page itself prints.
  const counts = useAttentionCounts("/api/maintenance/attention-counts");
  const nav = React.useMemo(() => withAttentionBadges(NAV, counts), [counts]);

  return (
    <div data-skin="estate" data-portal-accent="maintenance">
      <PortalShell accent="maintenance" wordmark="sNeek" nav={nav} roleLabel="Maintenance">
        {children}
      </PortalShell>
    </div>
  );
}
