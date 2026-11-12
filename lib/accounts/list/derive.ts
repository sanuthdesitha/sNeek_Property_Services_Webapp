/**
 * Turns loaded account facts into the list the screen shows: rows, tab counts,
 * the summary line, filtering, sorting and the page. Pure, so the rules are
 * tested without a database.
 *
 * Sorting is done here over the whole filtered set because several columns
 * (status, documents, Jobs 30 d, QA 30 d) are derived rather than stored. A
 * missing figure always sorts last, whichever the direction, and is never
 * treated as zero.
 */
import type { Role } from "@prisma/client";
import { listResponse, type ListQuery } from "@/lib/admin/list-query";
import { accountStatus, attentionReasons, documentState, documentsNeedAttention, inviteAgeDays, type AccountFacts, type DocumentState } from "./attention";
import { ACCOUNT_TABS, tabIncludesRole, type AccountTab } from "./tabs";
import type { AccountFilters, AccountListResponse, AccountListVisibility, AccountRow, AccountSort } from "./types";

export type AccountRecord = AccountFacts & {
  name: string | null;
  email: string;
  phone: string | null;
  extraRoles: Role[];
  twoFactorEnabled: boolean;
  clientName: string | null;
  hourlyRate: number | null;
  lastSeenAt: Date | null;
  /** Assigned jobs this Sydney week (absent in older callers = 0). */
  jobsWeek?: number;
  /** Approved, unpaid pay adjustments (absent = 0). */
  owed?: number;
};

/** Quality hub figures per person; absent = no figure. */
export type AccountFigures = Map<string, { jobs30: number | null; qa30: number | null }>;

/** Roles whose work the Quality hub counts (an assigned clean). */
const FIELD_ROLES: ReadonlySet<Role> = new Set<Role>(["CLEANER"]);

export function buildRow(record: AccountRecord, figures: AccountFigures, visibility: AccountListVisibility, now: Date): AccountRow {
  const docs: DocumentState = documentState(record, now);
  const row: AccountRow = {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    role: record.role,
    extraRoles: record.extraRoles,
    status: accountStatus(record),
    inviteAgeDays: inviteAgeDays(record, now),
    emailVerified: record.emailVerified !== null,
    twoFactorEnabled: record.twoFactorEnabled,
    clientName: record.clientName,
    documents: { kind: docs.kind, label: docs.label },
    jobsWeek: record.jobsWeek ?? 0,
    lastSeenAt: record.lastSeenAt ? record.lastSeenAt.toISOString() : null,
    attention: attentionReasons(record, now),
  };
  if (visibility.pay) {
    row.rate = record.hourlyRate;
    row.owed = record.owed ?? 0;
  }
  if (visibility.quality) {
    const counted = FIELD_ROLES.has(record.role) || record.extraRoles.some((role) => FIELD_ROLES.has(role));
    const figure = figures.get(record.id);
    // A cleaner with no clean in the window has a real 0; anyone else has no figure.
    row.jobs30 = figure ? figure.jobs30 : counted ? 0 : null;
    row.qa30 = figure ? figure.qa30 : null;
  }
  return row;
}

function inTab(row: AccountRow, tab: AccountTab): boolean {
  if (tab === "attention") return row.attention.length > 0;
  return tabIncludesRole(tab, row.role);
}

export function tabCounts(rows: AccountRow[]): Record<AccountTab, number> {
  const counts = Object.fromEntries(ACCOUNT_TABS.map((tab) => [tab, 0])) as Record<AccountTab, number>;
  for (const row of rows) {
    for (const tab of ACCOUNT_TABS) if (inTab(row, tab)) counts[tab] += 1;
  }
  return counts;
}

function matchesSearch(row: AccountRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "");
  const phone = (row.phone ?? "").replace(/\D/g, "");
  return `${row.name ?? ""} ${row.email}`.toLowerCase().includes(needle) || (digits.length >= 3 && phone.includes(digits));
}

export function filterRows(rows: AccountRow[], filters: AccountFilters): AccountRow[] {
  return rows.filter((row) => {
    if (!inTab(row, filters.tab)) return false;
    if (filters.role && row.role !== filters.role) return false;
    if (filters.status !== "all" && row.status !== filters.status.toUpperCase()) return false;
    if (filters.documents && !documentsNeedAttention(row.documents)) return false;
    // `rate` is only on the row when the viewer may see pay; null = no rate set.
    if (filters.noRate && row.rate !== null) return false;
    return matchesSearch(row, filters.q);
  });
}

const STATUS_ORDER = { ACTIVE: 0, INVITED: 1, DISABLED: 2 } as const;
const DOCUMENT_ORDER = { MISSING: 0, EXPIRED: 1, EXPIRING: 2, NONE: 3, OK: 4 } as const;

function sortValue(row: AccountRow, sort: AccountSort): string | number | null {
  switch (sort) {
    case "name":
      return (row.name ?? row.email).toLowerCase();
    case "role":
      return row.role;
    case "status":
      return STATUS_ORDER[row.status];
    case "rate":
      return row.rate ?? null;
    case "jobs30":
      return row.jobs30 ?? null;
    case "qa30":
      return row.qa30 ?? null;
    case "documents":
      return DOCUMENT_ORDER[row.documents.kind];
    case "lastSeen":
      return row.lastSeenAt;
    case "jobsWeek":
      return row.jobsWeek;
    case "owed":
      return row.owed ?? null;
  }
}

export function sortRows(rows: AccountRow[], sort: AccountSort, dir: "asc" | "desc"): AccountRow[] {
  const factor = dir === "asc" ? 1 : -1;
  const byName = (a: AccountRow, b: AccountRow) => (a.name ?? a.email).localeCompare(b.name ?? b.email) || a.id.localeCompare(b.id);
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

export function summarize(rows: AccountRow[]): AccountListResponse["summary"] {
  return {
    people: rows.length,
    invitesPending: rows.filter((row) => row.status === "INVITED").length,
    documentsExpiring: rows.filter((row) => row.documents.kind === "EXPIRING").length,
    documentsExpired: rows.filter((row) => row.documents.kind === "EXPIRED").length,
    documentsMissing: rows.filter((row) => row.documents.kind === "MISSING").length,
  };
}

export function buildListResponse(
  allRows: AccountRow[],
  filters: AccountFilters,
  query: ListQuery<AccountSort>,
  visibility: AccountListVisibility,
): AccountListResponse {
  const filtered = sortRows(filterRows(allRows, filters), query.sort, query.dir);
  const page = filtered.slice(query.skip, query.skip + query.take);
  return {
    ...listResponse(page, filtered.length, query),
    tab: filters.tab,
    counts: tabCounts(allRows),
    summary: summarize(allRows),
    columns: visibility,
  };
}
