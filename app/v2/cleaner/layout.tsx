"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { LocationTracker } from "@/components/v2/cleaner/location-tracker";
import {
  Home,
  CalendarDays,
  CalendarRange,
  LayoutGrid,
  Navigation,
  Package,
  LineChart,
  ShieldCheck,
  Users,
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
  { href: "/v2/cleaner", label: "Today", icon: Home },
  { href: "/v2/cleaner/jobs", label: "Jobs", icon: CalendarDays },
  { href: "/v2/cleaner/calendar", label: "Schedule", icon: CalendarRange },
  { href: "/v2/cleaner/pay", label: "Pay", icon: LineChart },
  { href: "/v2/cleaner/more", label: "More", icon: LayoutGrid },
  // After More → desktop rail + mobile drawer only (not the bottom bar).
  { href: "/v2/cleaner/route", label: "Route", icon: Navigation },
  { href: "/v2/cleaner/supplies", label: "Supplies", icon: Package },
  { href: "/v2/cleaner/quality", label: "QA feedback", icon: ShieldCheck },
  { href: "/v2/cleaner/hub", label: "Team hub", icon: Users },
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

  const nav = React.useMemo(
    () =>
      NAV.map((item) => {
        const count = counts[item.href] ?? 0;
        return count > 0 ? { ...item, badge: count } : item;
      }),
    [counts]
  );

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
