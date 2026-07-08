"use client";

import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  Home,
  Waves,
  Truck,
  Radar,
  CalendarRange,
  Users,
  Receipt,
  BarChart3,
  TrendingUp,
  History,
  User,
  Settings,
} from "lucide-react";

// Full laundry nav. First five surface in the mobile bottom bar (daily-use
// screens); the rest appear in the desktop rail + mobile drawer.
const NAV: NavItem[] = [
  { href: "/v2/laundry", label: "Today", icon: Home },
  { href: "/v2/laundry/queue", label: "Queue", icon: Waves },
  { href: "/v2/laundry/runs", label: "Runs", icon: Truck },
  { href: "/v2/laundry/tracking", label: "Tracking", icon: Radar },
  { href: "/v2/laundry/calendar", label: "Calendar", icon: CalendarRange },
  { href: "/v2/laundry/hub", label: "Team hub", icon: Users },
  { href: "/v2/laundry/invoices", label: "Invoices", icon: Receipt },
  { href: "/v2/laundry/reports", label: "Reports", icon: BarChart3 },
  { href: "/v2/laundry/stats", label: "Stats", icon: TrendingUp },
  { href: "/v2/laundry/history", label: "History", icon: History },
  { href: "/v2/laundry/profile", label: "Profile", icon: User },
  { href: "/v2/laundry/settings", label: "Settings", icon: Settings },
];

export default function V2LaundryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="laundry">
      <PortalShell accent="laundry" wordmark="sNeek" nav={NAV} roleLabel="Laundry">
        {children}
      </PortalShell>
    </div>
  );
}
