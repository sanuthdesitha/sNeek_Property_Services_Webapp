/**
 * Pure rules for People › Clients: rows from loaded facts, chip counts,
 * filtering, sorting, paging, header figures and the CSV. Sorting runs over
 * the whole filtered set on the server (owing, last clean and logins are
 * derived, not stored). A missing figure sorts last in both directions and is
 * never treated as zero.
 */
import { listResponse, type ListQuery } from "@/lib/admin/list-query";
import {
  CLIENT_DIRECTORY_FILTERS,
  type ClientAttentionReason,
  type ClientDirectoryFigures,
  type ClientDirectoryFilter,
  type ClientDirectoryFilters,
  type ClientDirectoryResponse,
  type ClientDirectoryRow,
  type ClientDirectorySort,
  type ClientDirectoryVisibility,
} from "./types";

export type ClientFacts = {
  id: string;
  name: string;
  suburb: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  properties: number;
  logins: number;
  loginsInvited: number;
  assistants: number;
  invoicesOpen: number;
  /** Null when receivables could not be read. */
  owing: number | null;
  overdue: number | null;
  overdueCount: number;
  paidThisMonth: number | null;
  lastCleanDay: string | null;
};

export function clientAttention(facts: Pick<ClientFacts, "isActive" | "logins" | "loginsInvited" | "overdueCount">): ClientAttentionReason[] {
  const reasons: ClientAttentionReason[] = [];
  if (facts.overdueCount > 0) reasons.push("OVERDUE");
  if (facts.isActive && facts.logins === 0 && facts.loginsInvited === 0) reasons.push("NO_LOGIN");
  return reasons;
}

export function buildClientRow(facts: ClientFacts, visibility: ClientDirectoryVisibility): ClientDirectoryRow {
  const row: ClientDirectoryRow = {
    id: facts.id,
    name: facts.name,
    suburb: facts.suburb,
    email: facts.email,
    phone: facts.phone,
    isActive: facts.isActive,
    createdAt: facts.createdAt.toISOString(),
    properties: facts.properties,
    logins: facts.logins,
    loginsInvited: facts.loginsInvited,
    assistants: facts.assistants,
    lastCleanDay: facts.lastCleanDay,
    attention: clientAttention(facts),
  };
  if (visibility.money) {
    row.invoicesOpen = facts.invoicesOpen;
    row.owing = facts.owing;
    row.overdue = facts.overdue;
    row.overdueCount = facts.overdueCount;
    row.paidThisMonth = facts.paidThisMonth;
  }
  return row;
}

export function matchesClientFilter(row: ClientDirectoryRow, filter: ClientDirectoryFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return row.isActive;
    case "inactive":
      return !row.isActive;
    case "owing":
      return (row.owing ?? 0) > 0;
    case "overdue":
      return (row.overdueCount ?? 0) > 0;
    case "no-login":
      return row.logins === 0;
    case "assistants":
      return row.assistants > 0;
    case "attention":
      return row.attention.length > 0;
  }
}

function matchesSearch(row: ClientDirectoryRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.email, row.suburb, row.phone].some((value) => (value ?? "").toLowerCase().includes(needle));
}

export function filterClientRows(rows: ClientDirectoryRow[], filters: ClientDirectoryFilters): ClientDirectoryRow[] {
  return rows.filter((row) => matchesClientFilter(row, filters.filter) && matchesSearch(row, filters.q));
}

export function clientFilterCounts(rows: ClientDirectoryRow[]): Record<ClientDirectoryFilter, number> {
  const counts = Object.fromEntries(CLIENT_DIRECTORY_FILTERS.map((filter) => [filter, 0])) as Record<ClientDirectoryFilter, number>;
  for (const row of rows) {
    for (const filter of CLIENT_DIRECTORY_FILTERS) if (matchesClientFilter(row, filter)) counts[filter] += 1;
  }
  return counts;
}

function sortValue(row: ClientDirectoryRow, sort: ClientDirectorySort): string | number | null {
  switch (sort) {
    case "name":
      return row.name.toLowerCase();
    case "properties":
      return row.properties;
    case "logins":
      return row.logins;
    case "invoicesOpen":
      return row.invoicesOpen ?? null;
    case "owing":
      return row.owing ?? null;
    case "lastClean":
      return row.lastCleanDay;
    case "status":
      return row.isActive ? 0 : 1;
  }
}

export function sortClientRows(rows: ClientDirectoryRow[], sort: ClientDirectorySort, dir: "asc" | "desc"): ClientDirectoryRow[] {
  const factor = dir === "asc" ? 1 : -1;
  const byName = (a: ClientDirectoryRow, b: ClientDirectoryRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort);
    const right = sortValue(b, sort);
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left < right) return -1 * factor;
    if (left > right) return 1 * factor;
    return byName(a, b);
  });
}

function sumOrNull(values: Array<number | null | undefined>): number | null {
  if (values.some((value) => value === null || value === undefined)) return null;
  return Number(values.reduce<number>((sum, value) => sum + (value ?? 0), 0).toFixed(2));
}

export function clientFigures(rows: ClientDirectoryRow[], activeProperties: number, visibility: ClientDirectoryVisibility): ClientDirectoryFigures {
  return {
    totalClients: rows.length,
    activeProperties,
    outstanding: visibility.money ? sumOrNull(rows.map((row) => row.owing)) : null,
    overdue: visibility.money ? sumOrNull(rows.map((row) => row.overdue)) : null,
    paidThisMonth: visibility.money ? sumOrNull(rows.map((row) => row.paidThisMonth)) : null,
  };
}

export function buildClientDirectoryResponse(
  allRows: ClientDirectoryRow[],
  filters: ClientDirectoryFilters,
  query: ListQuery<ClientDirectorySort>,
  visibility: ClientDirectoryVisibility,
  activeProperties: number,
): ClientDirectoryResponse {
  const filtered = sortClientRows(filterClientRows(allRows, filters), query.sort, query.dir);
  return {
    ...listResponse(filtered.slice(query.skip, query.skip + query.take), filtered.length, query),
    filter: filters.filter,
    counts: clientFilterCounts(allRows),
    figures: clientFigures(allRows, activeProperties, visibility),
    columns: visibility,
  };
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A spreadsheet must never run a formula from a stored name.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function clientDirectoryCsv(rows: ClientDirectoryRow[], visibility: ClientDirectoryVisibility): string {
  const header = ["Client", "Suburb", "Email", "Phone", "Properties", "Portal logins", "Assistants"];
  if (visibility.money) header.push("Invoices open", "Owing", "Overdue", "Paid this month");
  header.push("Last clean", "Status");
  const lines = rows.map((row) => {
    const cells: Array<string | number | null | undefined> = [row.name, row.suburb, row.email, row.phone, row.properties, row.logins, row.assistants];
    if (visibility.money) cells.push(row.invoicesOpen, row.owing, row.overdue, row.paidThisMonth);
    cells.push(row.lastCleanDay, row.isActive ? "Active" : "Inactive");
    return cells.map(csvCell).join(",");
  });
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
