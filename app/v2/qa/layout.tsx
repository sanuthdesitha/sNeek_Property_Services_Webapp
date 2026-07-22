"use client";

import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { CalendarCheck, ClipboardCheck, AlertTriangle, MoreHorizontal } from "lucide-react";

// Phase 4 Stage 1 nav: Today · Reviews · Rework · More.
// (Stage 2 adds a Map tab between Rework and More — its route placeholder lives
// on the More page until then.)
const NAV: NavItem[] = [
  { href: "/v2/qa", label: "Today", icon: CalendarCheck },
  { href: "/v2/qa/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/v2/qa/rework", label: "Rework", icon: AlertTriangle },
  { href: "/v2/qa/more", label: "More", icon: MoreHorizontal },
];

export default function V2QaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="qa">
      <PortalShell accent="qa" wordmark="sNeek" nav={NAV} roleLabel="QA">
        {children}
      </PortalShell>
    </div>
  );
}
