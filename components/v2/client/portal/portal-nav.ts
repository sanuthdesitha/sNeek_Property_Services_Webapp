/**
 * Client portal navigation (approved boards "Client portal" and "Client portal
 * desktop", 2026-11).
 *
 * Plain module on purpose: the layout (client), the More page (server), the
 * request sheet and the tests all read these lists. Never add "use client"
 * here: a server component that reads a constant from a client module gets a
 * client reference instead of the value (tests/lib/server-client-value-imports).
 *
 * Phone: five tabs (Home, Cleans, Approvals, Money, More); Messages and the
 * Request sheet sit in the header. Desktop: the grouped rail below. Every
 * destination keeps its URL. Nothing here grants access: each page keeps its own
 * server guard; these gates only avoid offering a tap that would be refused.
 */
import {
  Boxes,
  Briefcase,
  Building2,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Gift,
  Home,
  Menu,
  MessageSquare,
  PackageSearch,
  Settings,
  Shirt,
  ShoppingCart,
  UserRound,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { VaPermissionKey } from "@/lib/va/permissions";

export const CLIENT_ROOT = "/v2/client";

/** Module switches a destination depends on (mirrors `isClientModuleEnabled`, plus task requests). */
export type ClientNavModule =
  | "jobs"
  | "calendar"
  | "reports"
  | "laundry"
  | "properties"
  | "inventory"
  | "shopping"
  | "stockRuns"
  | "cases"
  | "finance"
  | "quoteRequests"
  | "approvals"
  | "booking"
  | "taskRequests";

/**
 * Who may be offered a destination.
 * - "any": the client and any active assistant (the page still narrows scope).
 * - "client": the account holder only (money decisions, account management).
 * - a permission key: the client, or an assistant holding that grant.
 */
export type ClientNavGate = "any" | "client" | VaPermissionKey;

export interface ClientDestination {
  href: string;
  label: string;
  icon: LucideIcon;
  gate: ClientNavGate;
  module?: ClientNavModule;
}

export interface ClientRailItem extends ClientDestination {
  group: string;
}

/** What the viewer may be offered; modules absent = not known yet (no module filtering). */
export interface ClientNavViewer {
  actor: "CLIENT" | "VA";
  permissions: Partial<Record<string, boolean>>;
  modules?: Partial<Record<ClientNavModule, boolean>> | null;
}

const href = (path: string) => (path ? `${CLIENT_ROOT}/${path}` : CLIENT_ROOT);

/** Desktop rail, grouped exactly as the desktop board's side navigation. */
export const CLIENT_RAIL: readonly ClientRailItem[] = [
  { href: href(""), label: "Home", icon: Home, gate: "any", group: "Overview" },
  { href: href("jobs"), label: "Cleans", icon: Briefcase, gate: "any", module: "jobs", group: "Your cleans" },
  { href: href("calendar"), label: "Calendar", icon: CalendarRange, gate: "any", module: "calendar", group: "Your cleans" },
  { href: href("approvals"), label: "Approvals", icon: ClipboardCheck, gate: "client", module: "approvals", group: "Your cleans" },
  { href: href("reports"), label: "Reports", icon: FileText, gate: "reports", module: "reports", group: "Your cleans" },
  { href: href("laundry"), label: "Laundry", icon: Shirt, gate: "any", module: "laundry", group: "Your cleans" },
  { href: href("properties"), label: "Properties", icon: Building2, gate: "properties", module: "properties", group: "Your homes" },
  { href: href("inventory"), label: "Inventory", icon: Boxes, gate: "properties", module: "inventory", group: "Your homes" },
  { href: href("shopping"), label: "Shopping", icon: ShoppingCart, gate: "client", module: "shopping", group: "Your homes" },
  { href: href("stock-runs"), label: "Stock counts", icon: PackageSearch, gate: "client", module: "stockRuns", group: "Your homes" },
  { href: href("maintenance"), label: "Maintenance", icon: Wrench, gate: "maintenance", group: "Your homes" },
  { href: href("messages"), label: "Messages", icon: MessageSquare, gate: "messages", group: "Support" },
  { href: href("cases"), label: "Cases and disputes", icon: ClipboardList, gate: "maintenance", module: "cases", group: "Support" },
  { href: href("finance"), label: "Money", icon: Wallet, gate: "invoicesView", module: "finance", group: "Billing" },
  { href: href("quotes"), label: "Quotes", icon: FileSpreadsheet, gate: "client", group: "Billing" },
  { href: href("referrals"), label: "Referrals", icon: Gift, gate: "client", group: "Account" },
  { href: href("team"), label: "Assistants", icon: Users, gate: "client", group: "Account" },
  { href: href("profile"), label: "Profile and security", icon: UserRound, gate: "client", group: "Account" },
  { href: href("settings"), label: "Settings", icon: Settings, gate: "client", group: "Account" },
];

export interface ClientTab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that belong to this tab, so it stays lit on them. */
  activePrefixes: string[];
  /** A phone tab with no rail entry. */
  mobileOnly?: boolean;
}

/** The five phone tabs, in the drawn order. */
export const CLIENT_TABS: readonly ClientTab[] = [
  { href: href(""), label: "Home", icon: Home, activePrefixes: [] },
  { href: href("jobs"), label: "Cleans", icon: Briefcase, activePrefixes: [href("calendar"), href("services")] },
  { href: href("approvals"), label: "Approvals", icon: ClipboardCheck, activePrefixes: [href("quotes")] },
  { href: href("finance"), label: "Money", icon: Wallet, activePrefixes: [href("money")] },
  { href: href("more"), label: "More", icon: Menu, activePrefixes: [], mobileOnly: true },
];

/** One row of the More menu: one or two destinations side by side (board: "Referrals · Assistants"). */
export interface ClientMoreRow {
  key: string;
  links: readonly ClientDestination[];
}

export interface ClientMoreSection {
  title: string;
  rows: readonly ClientMoreRow[];
}

function railItem(path: string, label?: string): ClientDestination {
  const item = CLIENT_RAIL.find((entry) => entry.href === href(path));
  if (!item) throw new Error(`Unknown client destination ${path}`);
  return { href: item.href, label: label ?? item.label, icon: item.icon, gate: item.gate, module: item.module };
}

/** More menu, as drawn: three groups; paired rows keep both destinations reachable. */
export const CLIENT_MORE_SECTIONS: readonly ClientMoreSection[] = [
  {
    title: "Your cleans",
    rows: [
      { key: "jobs", links: [railItem("jobs", "Cleans list")] },
      { key: "calendar", links: [railItem("calendar")] },
      { key: "reports", links: [railItem("reports")] },
      { key: "laundry", links: [railItem("laundry")] },
    ],
  },
  {
    title: "Your homes",
    rows: [
      { key: "properties", links: [railItem("properties")] },
      { key: "inventory", links: [railItem("inventory")] },
      { key: "shopping", links: [railItem("shopping"), railItem("stock-runs")] },
      { key: "maintenance", links: [railItem("maintenance")] },
    ],
  },
  {
    title: "Support, billing, account",
    rows: [
      { key: "cases", links: [railItem("cases")] },
      { key: "quotes", links: [railItem("quotes", "My quotes")] },
      { key: "referrals", links: [railItem("referrals"), railItem("team")] },
      { key: "profile", links: [railItem("profile", "Profile"), railItem("settings")] },
    ],
  },
];

export interface ClientRequestItem {
  key: string;
  label: string;
  /** The board's right-hand hint. */
  hint: string;
  href: string;
  gate: ClientNavGate;
  module?: ClientNavModule;
}

/**
 * The "What do you need?" sheet, in the drawn order. Every entry opens an
 * existing flow; none of them creates anything by itself.
 */
export const CLIENT_REQUEST_ITEMS: readonly ClientRequestItem[] = [
  { key: "book", label: "Book a clean", hint: "New booking", href: href("booking"), gate: "bookings", module: "booking" },
  // A rebook starts from a finished clean (its Rebook link carries the source id).
  { key: "rebook", label: "Rebook a previous clean", hint: "Pick a finished clean", href: href("jobs"), gate: "bookings", module: "booking" },
  { key: "addon", label: "Extra task or add-on", hint: "On a clean", href: href("jobs"), gate: "tasksCreate", module: "taskRequests" },
  { key: "quote", label: "Request a quote", hint: "Estimate", href: href("quote"), gate: "client", module: "quoteRequests" },
  { key: "fix", label: "Something needs fixing", hint: "Maintenance", href: href("maintenance"), gate: "maintenance" },
  { key: "case", label: "Raise an issue or dispute", hint: "Cases", href: href("cases"), gate: "maintenance", module: "cases" },
  { key: "shopping", label: "Start a shopping run or stock count", hint: "Shopping", href: href("shopping"), gate: "client", module: "shopping" },
];

/** The gate rule. Fails closed for an assistant: an unknown permission is "no". */
export function gateAllows(gate: ClientNavGate, viewer: ClientNavViewer): boolean {
  if (viewer.actor === "CLIENT") return true;
  if (gate === "any") return true;
  if (gate === "client") return false;
  return viewer.permissions[gate] === true;
}

/** Module rule. Unknown module state (not yet loaded) does not hide anything. */
export function moduleAllows(module: ClientNavModule | undefined, viewer: ClientNavViewer): boolean {
  if (!module || !viewer.modules) return true;
  return viewer.modules[module] !== false;
}

export function destinationAllowed(item: Pick<ClientDestination, "gate" | "module">, viewer: ClientNavViewer): boolean {
  return gateAllows(item.gate, viewer) && moduleAllows(item.module, viewer);
}

/** Request sheet entries the viewer may be offered; shopping falls back to stock counts. */
export function requestItemsFor(viewer: ClientNavViewer): ClientRequestItem[] {
  return CLIENT_REQUEST_ITEMS.flatMap((item) => {
    if (item.key === "shopping" && gateAllows(item.gate, viewer) && !moduleAllows("shopping", viewer)) {
      return moduleAllows("stockRuns", viewer) ? [{ ...item, href: href("stock-runs"), module: "stockRuns" as const }] : [];
    }
    return destinationAllowed(item, viewer) ? [item] : [];
  });
}

/** More menu rows with only the links this viewer may open; empty rows and sections dropped. */
export function moreSectionsFor(viewer: ClientNavViewer): ClientMoreSection[] {
  return CLIENT_MORE_SECTIONS.map((section) => ({
    title: section.title,
    rows: section.rows
      .map((row) => ({ key: row.key, links: row.links.filter((link) => destinationAllowed(link, viewer)) }))
      .filter((row) => row.links.length > 0),
  })).filter((section) => section.rows.length > 0);
}
