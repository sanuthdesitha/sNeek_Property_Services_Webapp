"use client";

import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  Home,
  CalendarDays,
  CalendarRange,
  Navigation,
  Users,
  ShoppingCart,
  Package,
  PackageSearch,
  Receipt,
  HandCoins,
  Search,
  User,
  Settings,
} from "lucide-react";

// Flat NavItem list covering every important cleaner surface. The PortalShell
// renders it as the rail (desktop) + drawer (mobile); the bottom tab bar shows
// the first handful. Everything is native Estate — no v1 UI is mounted.
const NAV: NavItem[] = [
  { href: "/v2/cleaner", label: "Home", icon: Home },
  { href: "/v2/cleaner/jobs", label: "Jobs · Today", icon: CalendarDays },
  { href: "/v2/cleaner/calendar", label: "Calendar", icon: CalendarRange },
  { href: "/v2/cleaner/route", label: "Route · Driving", icon: Navigation },
  { href: "/v2/cleaner/hub", label: "Team hub", icon: Users },
  { href: "/v2/cleaner/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/v2/cleaner/restock", label: "Restock", icon: Package },
  { href: "/v2/cleaner/stock-runs", label: "Stock runs", icon: PackageSearch },
  { href: "/v2/cleaner/invoices", label: "Invoices", icon: Receipt },
  { href: "/v2/cleaner/pay-requests", label: "Pay requests", icon: HandCoins },
  { href: "/v2/cleaner/lost-found", label: "Lost & found", icon: Search },
  { href: "/v2/cleaner/profile", label: "Profile", icon: User },
  { href: "/v2/cleaner/settings", label: "Settings", icon: Settings },
];

export default function V2CleanerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="cleaner">
      <PortalShell accent="cleaner" wordmark="sNeek" nav={NAV} roleLabel="Cleaner">
        {children}
      </PortalShell>
    </div>
  );
}
