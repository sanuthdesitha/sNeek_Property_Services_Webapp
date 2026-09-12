"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { LocationTracker } from "@/components/v2/cleaner/location-tracker";
import { useMaintenanceSection } from "@/components/v2/portal/use-maintenance-section";
import { useAttentionCounts } from "@/components/v2/portal/use-attention-counts";
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  FileText,
  Home,
  LayoutGrid,
  LineChart,
  Navigation,
  Package,
  PackageSearch,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

// Cleaner nav. PortalShell uses its independent mobile tab map and the full
// supplied list for the desktop rail and mobile drawer.
//
// The bottom five are what a cleaner opens every day: Today, Jobs, Schedule,
// Pay, More. Route and Supplies moved into More (2026-08) — Route is only
// useful while actually driving and Supplies is a weekly errand, so neither
// earned a permanent thumb-reachable slot ahead of the schedule and the money.
// Native Estate — no v1 UI.
const NAV: NavItem[] = [
  // Daily destinations also appear in the independent mobile tab map.
  { href: "/v2/cleaner", label: "Today", icon: Home },
  { href: "/v2/cleaner/jobs", label: "Jobs", icon: CalendarDays },
  { href: "/v2/cleaner/calendar", label: "Schedule", icon: CalendarRange },
  { href: "/v2/cleaner/route", label: "Route", icon: Navigation },
  { href: "/v2/cleaner/pay", label: "Pay", icon: LineChart },

  // Everything below is the rail and the drawer. It used to live behind a
  // "More" page, which meant six of these appeared TWICE under two different
  // names — once in the nav and once on that page — and the other six could
  // only be reached through it. The shell has supported `group` all along;
  // nothing had ever used it.
  { href: "/v2/cleaner/supplies", label: "Supplies", icon: Package, group: "Work" },
  { href: "/v2/cleaner/quality", label: "QA feedback", icon: ShieldCheck, group: "Work" },
  { href: "/v2/cleaner/lost-found", label: "Lost & found", icon: PackageSearch, group: "Work" },

  { href: "/v2/cleaner/invoices", label: "Invoices", icon: FileText, group: "Money" },
  { href: "/v2/cleaner/pay-requests", label: "Pay requests", icon: CircleDollarSign, group: "Money" },

  { href: "/v2/cleaner/availability", label: "Availability", icon: CalendarClock, group: "You" },
  { href: "/v2/cleaner/hub", label: "Team hub", icon: Users, group: "You" },
  { href: "/v2/cleaner/profile", label: "Profile", icon: UserRound, group: "You" },
  { href: "/v2/cleaner/settings", label: "Settings", icon: Settings, group: "You" },
];

export default function V2CleanerLayout({ children }: { children: React.ReactNode }) {
  // Attention badges (R17). The shell has always supported `NavItem.badge` but
  // nothing ever supplied a number, so a cleaner had to open each screen to
  // find an unread QA fail or a job waiting to be accepted.
  //
  // One fetch, refreshed on an interval and on focus. A failure leaves the
  // counts empty and therefore renders no pills — the nav must never break
  // because a count could not be computed.
  const counts = useAttentionCounts("/api/cleaner/attention-counts");

  // CP-6. A cleaner has no maintenance screen by default — the entry appears
  // only while they are actually assigned to a maintenance item, and goes away
  // again when they are taken off it.
  const maintenance = useMaintenanceSection();

  const nav = React.useMemo(() => {
    // Conditional sections do not change the independent daily mobile tabs.
    const items = maintenance.assigned
      ? [
          ...NAV,
          {
            href: "/v2/cleaner/maintenance",
            label: "Maintenance",
            icon: Wrench,
            badge: maintenance.count || undefined,
          } satisfies NavItem,
        ]
      : NAV;
    return items.map((item) => {
      const count = counts[item.href] ?? 0;
      return count > 0 ? { ...item, badge: count } : item;
    });
  }, [counts, maintenance.assigned, maintenance.count]);

  return (
    <div data-skin="estate" data-portal-accent="cleaner">
      <PortalShell accent="cleaner" wordmark="sNeek" nav={nav} roleLabel="Cleaner">
        <LocationTracker />
        {children}
      </PortalShell>
    </div>
  );
}
