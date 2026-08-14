"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { useMaintenanceSection } from "@/components/v2/portal/use-maintenance-section";
import {
  CalendarCheck,
  ClipboardCheck,
  AlertTriangle,
  Wallet,
  MoreHorizontal,
  Wrench,
} from "lucide-react";

// Phase 4 Stage 1 nav: Today · Reviews · Rework · More.
// (Stage 2 adds a Map tab between Rework and More — its route placeholder lives
// on the More page until then.)
const NAV: NavItem[] = [
  { href: "/v2/qa", label: "Today", icon: CalendarCheck },
  { href: "/v2/qa/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/v2/qa/rework", label: "Rework", icon: AlertTriangle },
  // Inspections are paid work — the inspector gets the same first-class
  // earnings tab the cleaner portal has, not a link buried under "More".
  { href: "/v2/qa/pay", label: "Pay", icon: Wallet },
  { href: "/v2/qa/more", label: "More", icon: MoreHorizontal },
];

export default function V2QaLayout({ children }: { children: React.ReactNode }) {
  // CP-6. QA has no maintenance screen by default — the entry appears only
  // while this inspector is assigned to a maintenance item, and goes away again
  // when they are taken off it. Appended after the base five so the mobile
  // bottom bar (nav.slice(0, 5)) keeps its daily tabs.
  const maintenance = useMaintenanceSection();

  const nav = React.useMemo<NavItem[]>(
    () =>
      maintenance.assigned
        ? [
            ...NAV,
            {
              href: "/v2/qa/maintenance",
              label: "Maintenance",
              icon: Wrench,
              badge: maintenance.count || undefined,
            },
          ]
        : NAV,
    [maintenance.assigned, maintenance.count]
  );

  return (
    <div data-skin="estate" data-portal-accent="qa">
      <PortalShell accent="qa" wordmark="sNeek" nav={nav} roleLabel="QA">
        {children}
      </PortalShell>
    </div>
  );
}
