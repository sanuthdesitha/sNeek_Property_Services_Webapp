/**
 * Cleaner portal navigation (approved board "Cleaner portal", 2026-11).
 *
 * Plain module on purpose: the layout (client), the More page (server) and the
 * tests all read these lists. Never add "use client" here — a server component
 * that reads a constant from a client module gets a client reference instead of
 * the value (see tests/lib/server-client-value-imports.test.ts).
 *
 * Five bottom tabs on a phone: Today, Jobs, Supplies, Pay, More. Every other
 * destination keeps its URL and a labelled home in the More menu (phone) and the
 * desktop rail (grouped). Nothing here grants access: each page keeps its own
 * server guard.
 */
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  FileText,
  FolderOpen,
  Home,
  LineChart,
  Menu,
  Navigation,
  Package,
  PackageSearch,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const CLEANER_ROOT = "/v2/cleaner";

/** A destination's module gate, mirroring `isCleanerModuleEnabled`. */
export type CleanerNavModule = "calendar" | "lostFound" | "invoices" | "payRequests" | "shopping" | "stockRuns";

export interface CleanerTab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that belong to this tab, so it stays lit on them. */
  activePrefixes: string[];
}

/** The five bottom tabs, in the drawn order. */
export const CLEANER_TABS: readonly CleanerTab[] = [
  { href: CLEANER_ROOT, label: "Today", icon: Home, activePrefixes: [] },
  { href: `${CLEANER_ROOT}/jobs`, label: "Jobs", icon: CalendarDays, activePrefixes: [`${CLEANER_ROOT}/calendar`] },
  {
    href: `${CLEANER_ROOT}/supplies`,
    label: "Supplies",
    icon: Package,
    activePrefixes: [
      `${CLEANER_ROOT}/shopping`,
      `${CLEANER_ROOT}/stock-count`,
      `${CLEANER_ROOT}/quick-scan`,
      `${CLEANER_ROOT}/restock`,
      `${CLEANER_ROOT}/stock-runs`,
    ],
  },
  {
    href: `${CLEANER_ROOT}/pay`,
    label: "Pay",
    icon: LineChart,
    activePrefixes: [`${CLEANER_ROOT}/invoices`, `${CLEANER_ROOT}/pay-requests`],
  },
  {
    href: `${CLEANER_ROOT}/more`,
    label: "More",
    icon: Menu,
    activePrefixes: [
      `${CLEANER_ROOT}/route`,
      `${CLEANER_ROOT}/quality`,
      `${CLEANER_ROOT}/lost-found`,
      `${CLEANER_ROOT}/maintenance`,
      `${CLEANER_ROOT}/availability`,
      `${CLEANER_ROOT}/hub`,
      `${CLEANER_ROOT}/profile`,
      `${CLEANER_ROOT}/settings`,
    ],
  },
];

export interface CleanerMoreItem {
  href: string;
  label: string;
  /** What is behind the entry, in the board's words. */
  detail?: string;
  icon: LucideIcon;
  module?: CleanerNavModule;
  /** Shown only while the cleaner is assigned to a maintenance item. */
  requiresMaintenanceAssignment?: boolean;
}

export interface CleanerMoreSection {
  title: "Work" | "You";
  items: CleanerMoreItem[];
}

/** The More menu (board: "More menu (☰ tab, full-height sheet) · Role filtered"). */
export const CLEANER_MORE_SECTIONS: readonly CleanerMoreSection[] = [
  {
    title: "Work",
    items: [
      { href: `${CLEANER_ROOT}/route`, label: "Route and driving mode", icon: Navigation },
      { href: `${CLEANER_ROOT}/calendar`, label: "Schedule, month view", icon: CalendarRange, module: "calendar" },
      { href: `${CLEANER_ROOT}/quality`, label: "QA feedback", icon: ShieldCheck },
      { href: `${CLEANER_ROOT}/lost-found`, label: "Lost and found", icon: PackageSearch, module: "lostFound" },
      {
        href: `${CLEANER_ROOT}/maintenance`,
        label: "Maintenance",
        detail: "Only while you are assigned",
        icon: Wrench,
        requiresMaintenanceAssignment: true,
      },
    ],
  },
  {
    title: "You",
    items: [
      { href: `${CLEANER_ROOT}/availability`, label: "Availability and leave", icon: CalendarClock },
      { href: `${CLEANER_ROOT}/hub?tab=documents`, label: "Documents", detail: "Upload, sign, expiry", icon: FolderOpen },
      { href: `${CLEANER_ROOT}/hub`, label: "Team hub", detail: "Feed, recognition, learning, chat", icon: Users },
      { href: `${CLEANER_ROOT}/profile`, label: "Profile", detail: "Contact, bank, payout, tax, skills", icon: UserRound },
      { href: `${CLEANER_ROOT}/settings`, label: "Settings", detail: "Appearance, password, 2FA, passkey", icon: Settings },
    ],
  },
];

export interface CleanerRailItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group?: "Work" | "Money" | "You";
}

/**
 * The desktop rail (and search). Same destinations as the tabs plus the More
 * menu; Invoices and Pay requests stay listed for keyboard and desktop users
 * although on a phone they are tabs of Pay.
 */
export const CLEANER_RAIL: readonly CleanerRailItem[] = [
  { href: CLEANER_ROOT, label: "Today", icon: Home },
  { href: `${CLEANER_ROOT}/jobs`, label: "Jobs", icon: CalendarDays },
  { href: `${CLEANER_ROOT}/supplies`, label: "Supplies", icon: Package },
  { href: `${CLEANER_ROOT}/pay`, label: "Pay", icon: LineChart },
  { href: `${CLEANER_ROOT}/route`, label: "Route", icon: Navigation, group: "Work" },
  { href: `${CLEANER_ROOT}/calendar`, label: "Schedule", icon: CalendarRange, group: "Work" },
  { href: `${CLEANER_ROOT}/quality`, label: "QA feedback", icon: ShieldCheck, group: "Work" },
  { href: `${CLEANER_ROOT}/lost-found`, label: "Lost & found", icon: PackageSearch, group: "Work" },
  { href: `${CLEANER_ROOT}/invoices`, label: "Invoices", icon: FileText, group: "Money" },
  { href: `${CLEANER_ROOT}/pay-requests`, label: "Pay requests", icon: CircleDollarSign, group: "Money" },
  { href: `${CLEANER_ROOT}/availability`, label: "Availability", icon: CalendarClock, group: "You" },
  { href: `${CLEANER_ROOT}/hub`, label: "Team hub", icon: Users, group: "You" },
  { href: `${CLEANER_ROOT}/profile`, label: "Profile", icon: UserRound, group: "You" },
  { href: `${CLEANER_ROOT}/settings`, label: "Settings", icon: Settings, group: "You" },
];

export const CLEANER_MAINTENANCE_RAIL_ITEM: CleanerRailItem = {
  href: `${CLEANER_ROOT}/maintenance`,
  label: "Maintenance",
  icon: Wrench,
  group: "Work",
};

/**
 * Inside one job the phone shows only the job: no portal header and no tab bar,
 * so the bottom button is always the next step (board decision). The job list
 * itself is an ordinary tab page.
 */
export function isCleanerJobScreen(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return /^\/v2\/cleaner\/jobs\/[^/]+(\/.*)?$/.test(pathname);
}

/** Which modules gate which More entries; `true` when the entry has no gate. */
export function moreItemVisible(
  item: CleanerMoreItem,
  modules: Partial<Record<CleanerNavModule, boolean>>,
  maintenanceAssigned: boolean,
): boolean {
  if (item.requiresMaintenanceAssignment && !maintenanceAssigned) return false;
  if (item.module && modules[item.module] === false) return false;
  return true;
}
