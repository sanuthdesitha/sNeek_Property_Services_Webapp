"use client";

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
  Users,
} from "lucide-react";

// Cleaner nav. PortalShell renders nav.slice(0,5) as the mobile bottom tabs and
// the FULL list as the desktop rail + mobile drawer. So the first five are the
// bottom bar (Today, Jobs, Route, Supplies, More); everything after More is
// reachable from the rail/drawer + the richer More hub. Native Estate — no v1 UI.
const NAV: NavItem[] = [
  { href: "/v2/cleaner", label: "Today", icon: Home },
  { href: "/v2/cleaner/jobs", label: "Jobs", icon: CalendarDays },
  { href: "/v2/cleaner/route", label: "Route", icon: Navigation },
  { href: "/v2/cleaner/supplies", label: "Supplies", icon: Package },
  { href: "/v2/cleaner/more", label: "More", icon: LayoutGrid },
  // After More → desktop rail + mobile drawer only (not the bottom bar).
  { href: "/v2/cleaner/calendar", label: "Schedule", icon: CalendarRange },
  { href: "/v2/cleaner/pay", label: "Pay & performance", icon: LineChart },
  { href: "/v2/cleaner/hub", label: "Team hub", icon: Users },
];

export default function V2CleanerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="cleaner">
      {/* Background live-location tracker — persists for the whole active-job
          window regardless of which screen is open. Renders nothing. */}
      <LocationTracker />
      <PortalShell accent="cleaner" wordmark="sNeek" nav={NAV} roleLabel="Cleaner">
        {children}
      </PortalShell>
    </div>
  );
}
