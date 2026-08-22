"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  useAttentionCounts,
  withAttentionBadges,
} from "@/components/v2/portal/use-attention-counts";
import {
  BarChart3,
  CalendarRange,
  History,
  Home,
  Radar,
  Receipt,
  Settings,
  TrendingUp,
  Truck,
  User,
  Users,
  Waves,
} from "lucide-react";

// Full laundry nav. First five surface in the mobile bottom bar (daily-use
// screens); the rest appear in the desktop rail + mobile drawer.
const NAV: NavItem[] = [
  // First five are the mobile bottom bar: the boards a driver works from.
  { href: "/v2/laundry", label: "Today", icon: Home },
  { href: "/v2/laundry/queue", label: "Queue", icon: Waves },
  { href: "/v2/laundry/runs", label: "Runs", icon: Truck },
  { href: "/v2/laundry/tracking", label: "Tracking", icon: Radar },
  { href: "/v2/laundry/calendar", label: "Calendar", icon: CalendarRange },

  { href: "/v2/laundry/reports", label: "Reports", icon: BarChart3, group: "Records" },
  { href: "/v2/laundry/stats", label: "Stats", icon: TrendingUp, group: "Records" },
  { href: "/v2/laundry/history", label: "History", icon: History, group: "Records" },

  { href: "/v2/laundry/invoices", label: "Invoices", icon: Receipt, group: "Money" },

  { href: "/v2/laundry/hub", label: "Team hub", icon: Users, group: "You" },
  { href: "/v2/laundry/profile", label: "Profile", icon: User, group: "You" },
  { href: "/v2/laundry/settings", label: "Settings", icon: Settings, group: "You" },
];

export default function V2LaundryLayout({ children }: { children: React.ReactNode }) {
  // Nav badges: work waiting, so a driver does not have to open each board to
  // find it. Counts mirror each page's own queue definition.
  const counts = useAttentionCounts("/api/laundry/attention-counts");
  const nav = React.useMemo(() => withAttentionBadges(NAV, counts), [counts]);

  return (
    <div data-skin="estate" data-portal-accent="laundry">
      <PortalShell accent="laundry" wordmark="sNeek" nav={nav} roleLabel="Laundry">
        {children}
      </PortalShell>
    </div>
  );
}
