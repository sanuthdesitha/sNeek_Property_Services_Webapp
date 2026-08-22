"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { LocationTracker } from "@/components/v2/cleaner/location-tracker";
import { useMaintenanceSection } from "@/components/v2/portal/use-maintenance-section";
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

// Cleaner nav. PortalShell renders nav.slice(0,5) as the mobile bottom tabs and
// the FULL list as the desktop rail + mobile drawer.
//
// The bottom five are what a cleaner opens every day: Today, Jobs, Schedule,
// Pay, More. Route and Supplies moved into More (2026-08) — Route is only
// useful while actually driving and Supplies is a weekly errand, so neither
// earned a permanent thumb-reachable slot ahead of the schedule and the money.
// Native Estate — no v1 UI.
const NAV: NavItem[] = [
  // The first five are the mobile bottom bar (portal-shell slices them), so
  // they are the screens a cleaner opens with a thumb mid-shift.
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
  const [counts, setCounts] = React.useState<Record<string, number>>({});

  // CP-6. A cleaner has no maintenance screen by default — the entry appears
  // only while they are actually assigned to a maintenance item, and goes away
  // again when they are taken off it.
  const maintenance = useMaintenanceSection();

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/cleaner/attention-counts", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (!cancelled && body?.counts) setCounts(body.counts as Record<string, number>);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  const nav = React.useMemo(() => {
    // Appended AFTER the base list on purpose: PortalShell renders
    // nav.slice(0, 5) as the mobile bottom tabs, so a conditional entry must
    // never push a daily tab off the thumb bar.
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
      {/* Background live-location tracker — persists for the whole active-job
          window regardless of which screen is open. Renders nothing. */}
      <LocationTracker />
      <PortalShell accent="cleaner" wordmark="sNeek" nav={nav} roleLabel="Cleaner">
        {children}
      </PortalShell>
    </div>
  );
}
