/**
 * Laundry portal navigation (board "Laundry partner portal", 2026-11).
 *
 * PLAIN module on purpose (no "use client"): the layout (client), the More
 * page (server) and tests read these lists. A server component that reads a
 * constant from a client module gets a client reference instead of the value
 * (tests/lib/server-client-value-imports.test.ts).
 *
 * Phone: five tabs, Today, Runs, Tracking, History, More (lib/navigation/
 * mobile-tabs.ts). Every other destination keeps its URL and a home in the
 * More menu and the desktop rail. Nothing here grants access: each page keeps
 * its own server guard.
 */
import {
  BarChart3,
  CalendarRange,
  History,
  Home,
  Inbox,
  Menu,
  Radar,
  Receipt,
  Route,
  Settings,
  TrendingUp,
  Truck,
  User,
  Users,
  Waves,
  type LucideIcon,
} from "lucide-react";

export type LaundryNavEntry = { href: string; label: string; icon: LucideIcon; group?: string; detail?: string; mobileOnly?: boolean };

export const LAUNDRY_REQUESTS_PATH = "/v2/laundry/requests";

/** Desktop rail (grouped) and the phone tabs' sources, in order. */
export const LAUNDRY_NAV: readonly LaundryNavEntry[] = [
  { href: "/v2/laundry", label: "Today", icon: Home },
  { href: "/v2/laundry/runs", label: "Runs", icon: Truck },
  { href: "/v2/laundry/tracking", label: "Tracking", icon: Radar },
  { href: "/v2/laundry/history", label: "History", icon: History },
  { href: LAUNDRY_REQUESTS_PATH, label: "From the office", icon: Inbox },
  { href: "/v2/laundry/queue", label: "Queue", icon: Waves, group: "Work" },
  { href: "/v2/laundry/route", label: "Route builder", icon: Route, group: "Work" },
  { href: "/v2/laundry/calendar", label: "Calendar", icon: CalendarRange, group: "Work" },
  { href: "/v2/laundry/reports", label: "Reports", icon: BarChart3, group: "Records" },
  { href: "/v2/laundry/stats", label: "Stats", icon: TrendingUp, group: "Records" },
  { href: "/v2/laundry/invoices", label: "Invoices", icon: Receipt, group: "Money" },
  { href: "/v2/laundry/hub", label: "Team hub", icon: Users, group: "You" },
  { href: "/v2/laundry/profile", label: "Profile", icon: User, group: "You" },
  { href: "/v2/laundry/settings", label: "Settings", icon: Settings, group: "You" },
  { href: "/v2/laundry/more", label: "More", icon: Menu, mobileOnly: true },
];

/** The More menu (board: "More menu (☰)"), in the drawn order, with the drawn descriptions. */
export const LAUNDRY_MORE_ITEMS: readonly LaundryNavEntry[] = [
  { href: LAUNDRY_REQUESTS_PATH, label: "From the office", icon: Inbox, detail: "Requests to answer" },
  { href: "/v2/laundry/queue", label: "Queue", icon: Waves, detail: "Every set by stage" },
  { href: "/v2/laundry/route", label: "Route builder and draft", icon: Route, detail: "Pick, order and start today's route" },
  { href: "/v2/laundry/calendar", label: "Calendar", icon: CalendarRange, detail: "Pickups and returns" },
  { href: "/v2/laundry/reports", label: "Reports", icon: BarChart3, detail: "Last 30 days" },
  { href: "/v2/laundry/stats", label: "Stats", icon: TrendingUp },
  { href: "/v2/laundry/invoices", label: "Invoices", icon: Receipt, detail: "Invoices and invoice template" },
  { href: "/v2/laundry/hub", label: "Team hub", icon: Users },
  { href: "/v2/laundry/profile", label: "Profile", icon: User, detail: "Bank, business, payout" },
  { href: "/v2/laundry/settings", label: "Settings", icon: Settings, detail: "Alerts, appearance" },
];

/** Paths whose phone tab stays lit (sub-pages of a tab). */
export const LAUNDRY_TAB_PREFIXES: Record<string, string[]> = {
  "/v2/laundry": ["/v2/laundry/stop"],
  "/v2/laundry/more": ["/v2/laundry/queue", "/v2/laundry/route", "/v2/laundry/calendar", "/v2/laundry/reports", "/v2/laundry/stats", "/v2/laundry/invoices", "/v2/laundry/hub", "/v2/laundry/profile", "/v2/laundry/settings", LAUNDRY_REQUESTS_PATH],
};
