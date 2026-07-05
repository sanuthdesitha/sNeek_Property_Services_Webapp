"use client";

import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { Home, ClipboardCheck, AlertTriangle, BarChart3, MoreHorizontal } from "lucide-react";

const NAV: NavItem[] = [
  { href: "/v2/qa", label: "Today", icon: Home },
  { href: "/v2/qa/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/v2/qa/rework", label: "Rework", icon: AlertTriangle },
  { href: "/v2/qa/stats", label: "Stats", icon: BarChart3 },
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
