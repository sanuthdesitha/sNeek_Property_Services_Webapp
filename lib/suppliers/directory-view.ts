/**
 * The Suppliers directory as drawn (board "Suppliers"): one list of laundry
 * partners, stock suppliers and trades, with type tabs, filters, columns and
 * sorting. PURE and PLAIN: the client screen and the tests use it.
 *
 * Unknowns stay unknown: a figure that was not measured reads "–", a missing
 * contact reads "No contact on file", never zero or blank success.
 */
import type { SupplierDirectoryResponse, SupplierDirectoryRow, TradeSupplierRecord } from "./directory-types";

export type DirectoryType = "LAUNDRY" | "STOCK" | "TRADES";
export type DirectoryTab = "all" | "laundry" | "stock" | "trades" | "inactive";
export type DirectorySort = "name" | "type" | "logins" | "progress" | "ontime";

export const DIRECTORY_TABS: ReadonlyArray<{ id: DirectoryTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "laundry", label: "Laundry partners" },
  { id: "stock", label: "Stock suppliers" },
  { id: "trades", label: "Trades and maintenance" },
  { id: "inactive", label: "Inactive" },
];

export const TYPE_LABELS: Record<DirectoryType, string> = { LAUNDRY: "Laundry", STOCK: "Stock", TRADES: "Trades" };

export type DirectoryEntry = {
  key: string;
  name: string;
  types: DirectoryType[];
  /** "Hardware · trade@…" / "ops@…" / "Electrical · 0413 …". */
  subtitle: string;
  terms: string;
  loginCount: number;
  invitedCount: number;
  loginsLabel: string;
  progressCount: number;
  lateCount: number;
  progressLabel: string;
  onTimePct: number | null;
  active: boolean;
  categories: string[];
  attention: string[];
  row: SupplierDirectoryRow | null;
  trade: TradeSupplierRecord | null;
  search: string;
};

export type DirectoryFilters = { tab: DirectoryTab; q: string; attention: boolean; withLogins: boolean; category: string; sort: DirectorySort; dir: "asc" | "desc" };

export const DEFAULT_FILTERS: DirectoryFilters = { tab: "all", q: "", attention: false, withLogins: false, category: "", sort: "name", dir: "asc" };

function contactOf(email: string | null | undefined, phone: string | null | undefined): string | null {
  return email?.trim() || phone?.trim() || null;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function fromSupplierRow(row: SupplierDirectoryRow): DirectoryEntry {
  const stock = row.stock;
  const partner = row.laundry;
  const types: DirectoryType[] = [...(partner ? (["LAUNDRY"] as const) : []), ...(stock ? (["STOCK"] as const) : [])];
  const categories = stock?.categories ?? [];
  const contact = contactOf(partner?.email ?? stock?.email, partner?.phone ?? stock?.phone);
  const subtitle = [categories.length ? categories.join(", ") : null, contact ?? "No contact on file"].filter(Boolean).join(" · ");
  const terms = [
    partner ? [partner.avgTurnaround == null ? "Turnaround not recorded" : `${partner.avgTurnaround} h`, partner.pricePerKg == null ? null : `$${partner.pricePerKg.toFixed(2)}/kg`].filter(Boolean).join(" · ") : null,
    stock ? `Lead ${stock.defaultLeadDays} d` : null,
  ].filter(Boolean).join(" · ");
  const team = partner?.team ?? [];
  const invitedCount = team.filter((member) => member.invitedAt).length;
  const stats = partner?.stats;
  const progressCount = stats ? stats.toPickUp + stats.atLaundry + stats.toDrop : 0;
  const lateCount = stats?.late ?? 0;
  const attention: string[] = [];
  if (lateCount) attention.push(`${plural(lateCount, "run")} over turnaround`);
  if (partner && partner.isActive && team.filter((member) => member.isActive).length === 0) attention.push("No laundry portal logins");
  if (!contact) attention.push("No contact on file");
  const active = (stock?.isActive ?? true) && (partner?.isActive ?? true);
  return {
    key: row.key,
    name: row.name,
    types,
    subtitle,
    terms,
    loginCount: team.length,
    invitedCount,
    loginsLabel: partner ? (team.length ? `${team.length}${invitedCount ? ` · ${invitedCount} invited` : ""}` : "None") : "None",
    progressCount,
    lateCount,
    progressLabel: partner ? (stats ? (progressCount ? plural(progressCount, "run") : "None") : "Not available") : "–",
    onTimePct: stats?.onTimePct ?? null,
    active,
    categories,
    attention,
    row,
    trade: null,
    search: [row.name, partner?.name, partner?.email, partner?.phone, stock?.email, stock?.phone, ...categories, ...team.map((member) => member.name ?? member.email)].filter(Boolean).join(" ").toLowerCase(),
  };
}

function fromTrade(trade: TradeSupplierRecord): DirectoryEntry {
  const contact = contactOf(trade.email, trade.phone);
  const attention: string[] = [];
  if (!contact) attention.push("No contact on file");
  const categories = trade.trade ? [trade.trade] : [];
  return {
    key: `trade:${trade.id}`,
    name: trade.name,
    types: ["TRADES"],
    subtitle: [trade.trade, contact ?? "No contact on file"].filter(Boolean).join(" · "),
    terms: "Not recorded",
    loginCount: trade.login ? 1 : 0,
    invitedCount: 0,
    loginsLabel: trade.login ? "1 login" : "None",
    progressCount: trade.openCases,
    lateCount: 0,
    progressLabel: trade.openCases ? plural(trade.openCases, "open case") : "None",
    onTimePct: null,
    active: trade.isActive,
    categories,
    attention,
    row: null,
    trade,
    search: [trade.name, trade.company, trade.trade, trade.email, trade.phone].filter(Boolean).join(" ").toLowerCase(),
  };
}

export function buildDirectoryEntries(response: Pick<SupplierDirectoryResponse, "rows" | "trades">): DirectoryEntry[] {
  return [...response.rows.map(fromSupplierRow), ...(response.trades ?? []).map(fromTrade)];
}

function inTab(entry: DirectoryEntry, tab: DirectoryTab): boolean {
  switch (tab) {
    case "laundry":
      return entry.active && entry.types.includes("LAUNDRY");
    case "stock":
      return entry.active && entry.types.includes("STOCK");
    case "trades":
      return entry.active && entry.types.includes("TRADES");
    case "inactive":
      return !entry.active;
    case "all":
    default:
      return true;
  }
}

export function tabCounts(entries: readonly DirectoryEntry[]): Record<DirectoryTab, number> {
  return Object.fromEntries(DIRECTORY_TABS.map((tab) => [tab.id, entries.filter((entry) => inTab(entry, tab.id)).length])) as Record<DirectoryTab, number>;
}

export function categoryOptions(entries: readonly DirectoryEntry[]): string[] {
  return Array.from(new Set(entries.flatMap((entry) => entry.categories))).sort((a, b) => a.localeCompare(b));
}

function sortValue(entry: DirectoryEntry, sort: DirectorySort): string | number {
  switch (sort) {
    case "type":
      return entry.types.map((type) => TYPE_LABELS[type]).join(" ");
    case "logins":
      return entry.loginCount;
    case "progress":
      return entry.progressCount;
    case "ontime":
      return entry.onTimePct ?? -1;
    case "name":
    default:
      return entry.name.toLowerCase();
  }
}

/** Tab, search, chips, category and sort; ties fall back to the name. */
export function filterDirectory(entries: readonly DirectoryEntry[], filters: DirectoryFilters): DirectoryEntry[] {
  const q = filters.q.trim().toLowerCase();
  const rows = entries.filter((entry) => {
    if (!inTab(entry, filters.tab)) return false;
    if (q && !entry.search.includes(q)) return false;
    if (filters.attention && entry.attention.length === 0) return false;
    if (filters.withLogins && entry.loginCount === 0) return false;
    if (filters.category && !entry.categories.includes(filters.category)) return false;
    return true;
  });
  const sign = filters.dir === "desc" ? -1 : 1;
  return rows.sort((a, b) => {
    const left = sortValue(a, filters.sort);
    const right = sortValue(b, filters.sort);
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return order * sign || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  });
}

/** Old `?type=` / tab ids keep working: `laundry`, `stock`, `trades`, `inactive`. */
export function readDirectoryTab(value: string | null | undefined): DirectoryTab {
  const known = DIRECTORY_TABS.find((tab) => tab.id === value);
  return known ? known.id : "all";
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The rows on screen as CSV (Export). */
export function directoryCsv(entries: readonly DirectoryEntry[]): string {
  const header = ["Supplier", "Type", "Details", "Terms", "Portal logins", "In progress", "On time %", "Active"];
  const lines = entries.map((entry) => [
    entry.name,
    entry.types.map((type) => TYPE_LABELS[type]).join(" + "),
    entry.subtitle,
    entry.terms,
    entry.loginsLabel,
    entry.progressLabel,
    entry.onTimePct,
    entry.active ? "Yes" : "No",
  ].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\n");
}
