/**
 * Maintenance portal navigation (approved board "Maintenance portal", 2026-11).
 *
 * Plain module on purpose: the layout (client), the More page (server) and the
 * tests all read these lists. Never add "use client" here
 * (tests/lib/server-client-value-imports.test.ts).
 *
 * Five bottom tabs on a phone: Today, Tickets, Replacements, Log, More. Settings
 * moved from the fifth tab into More, as drawn; its URL is unchanged.
 */
import { ClipboardList, Home, Menu, PackageSearch, Settings, Wrench } from "lucide-react";
import type { PortalMoreSection, PortalRailItem, PortalTab } from "@/lib/navigation/portal-more";

export const MAINTENANCE_ROOT = "/v2/maintenance";

export const MAINTENANCE_TABS: readonly PortalTab[] = [
  { href: MAINTENANCE_ROOT, label: "Today", icon: Home, activePrefixes: [] },
  { href: `${MAINTENANCE_ROOT}/tickets`, label: "Tickets", icon: Wrench, activePrefixes: [`${MAINTENANCE_ROOT}/visits`] },
  { href: `${MAINTENANCE_ROOT}/replacements`, label: "Replacements", icon: PackageSearch, activePrefixes: [] },
  { href: `${MAINTENANCE_ROOT}/log`, label: "Log", icon: ClipboardList, activePrefixes: [] },
  { href: `${MAINTENANCE_ROOT}/more`, label: "More", icon: Menu, activePrefixes: [`${MAINTENANCE_ROOT}/settings`] },
];

export const MAINTENANCE_MORE_SECTIONS: readonly PortalMoreSection[] = [
  {
    title: "Work",
    items: [{ href: `${MAINTENANCE_ROOT}/log`, label: "Log", detail: "Completed records", icon: ClipboardList }],
  },
  {
    title: "You",
    items: [
      {
        href: `${MAINTENANCE_ROOT}/settings`,
        label: "Settings",
        detail: "Contact, notifications, appearance, security",
        icon: Settings,
      },
    ],
  },
];

export const MAINTENANCE_RAIL: readonly PortalRailItem[] = [
  { href: MAINTENANCE_ROOT, label: "Today", icon: Home },
  { href: `${MAINTENANCE_ROOT}/tickets`, label: "Tickets", icon: Wrench },
  { href: `${MAINTENANCE_ROOT}/replacements`, label: "Replacements", icon: PackageSearch },
  { href: `${MAINTENANCE_ROOT}/log`, label: "Log", icon: ClipboardList },
  { href: `${MAINTENANCE_ROOT}/settings`, label: "Settings", icon: Settings, group: "You" },
];
