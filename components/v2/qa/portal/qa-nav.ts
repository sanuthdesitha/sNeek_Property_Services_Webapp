/**
 * QA portal navigation (approved board "QA portal", 2026-11).
 *
 * Plain module on purpose: the layout (client), the More page (server) and the
 * tests all read these lists. Never add "use client" here — a server component
 * that reads a constant from a client module gets a client reference instead of
 * the value (see tests/lib/server-client-value-imports.test.ts).
 *
 * Five bottom tabs on a phone: Today, Reviews, Rework, Pay, More. Every other
 * destination keeps its URL and a labelled home in the More menu (phone) and the
 * desktop rail. Nothing here grants access: each page keeps its own server guard.
 */
import {
  AlertTriangle,
  CalendarCheck,
  ClipboardCheck,
  Menu,
  Receipt,
  RotateCcw,
  TrendingUp,
  User,
  UserPlus,
  Wallet,
  Wrench,
} from "lucide-react";
import type { PortalMoreSection, PortalRailItem, PortalTab } from "@/lib/navigation/portal-more";

export const QA_ROOT = "/v2/qa";

/** The five bottom tabs, in the drawn order. */
export const QA_TABS: readonly PortalTab[] = [
  { href: QA_ROOT, label: "Today", icon: CalendarCheck, activePrefixes: [`${QA_ROOT}/jobs`] },
  { href: `${QA_ROOT}/reviews`, label: "Reviews", icon: ClipboardCheck, activePrefixes: [] },
  { href: `${QA_ROOT}/rework`, label: "Rework", icon: AlertTriangle, activePrefixes: [] },
  { href: `${QA_ROOT}/pay`, label: "Pay", icon: Wallet, activePrefixes: [] },
  {
    href: `${QA_ROOT}/more`,
    label: "More",
    icon: Menu,
    activePrefixes: [`${QA_ROOT}/stats`, `${QA_ROOT}/invoices`, `${QA_ROOT}/maintenance`, `${QA_ROOT}/profile`],
  },
];

/** The More menu (board: "More menu (☰)"). */
export const QA_MORE_SECTIONS: readonly PortalMoreSection[] = [
  {
    title: "Work",
    items: [
      { href: `${QA_ROOT}/stats`, label: "Stats", detail: "Team quality, last 7 days", icon: TrendingUp },
      { href: `${QA_ROOT}/invoices`, label: "Invoices", detail: "Download or email", icon: Receipt },
      {
        href: `${QA_ROOT}/maintenance`,
        label: "Maintenance",
        detail: "Only while you are assigned",
        icon: Wrench,
        requiresMaintenanceAssignment: true,
      },
    ],
  },
  {
    title: "You",
    items: [{ href: `${QA_ROOT}/profile`, label: "Profile", detail: "Bank, invoicing, security", icon: User }],
  },
  {
    title: "Office-only queue tools",
    officeOnly: true,
    items: [
      {
        href: `${QA_ROOT}#office-queue-tools`,
        label: "Assign or move inspector",
        detail: "QA leads only: day planner and assignment on Today",
        icon: UserPlus,
      },
      {
        href: `${QA_ROOT}/reviews`,
        label: "Reopen a submitted inspection",
        detail: "Open the review, then reopen it with a reason",
        icon: RotateCcw,
      },
    ],
  },
];

/** The desktop rail (and navigation search): the tabs plus the More entries. */
export const QA_RAIL: readonly PortalRailItem[] = [
  { href: QA_ROOT, label: "Today", icon: CalendarCheck },
  { href: `${QA_ROOT}/reviews`, label: "Reviews", icon: ClipboardCheck },
  { href: `${QA_ROOT}/rework`, label: "Rework", icon: AlertTriangle },
  { href: `${QA_ROOT}/pay`, label: "Pay", icon: Wallet },
  { href: `${QA_ROOT}/stats`, label: "Stats", icon: TrendingUp },
  { href: `${QA_ROOT}/invoices`, label: "Invoices", icon: Receipt, group: "Money" },
  { href: `${QA_ROOT}/profile`, label: "Profile", icon: User, group: "You" },
];

export const QA_MAINTENANCE_RAIL_ITEM: PortalRailItem = {
  href: `${QA_ROOT}/maintenance`,
  label: "Maintenance",
  icon: Wrench,
};
