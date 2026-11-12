/**
 * Shapes and query contract for the paginated Accounts list
 * (`GET /api/admin/users?paginated=1` and its CSV export). Pure.
 */
import type { Role } from "@prisma/client";
import { ListQueryError, parseListQuery, readQueryValue, type ListQuery, type ListResponse } from "@/lib/admin/list-query";
import type { AccountStatus, AttentionReason, DocumentState } from "./attention";
import { normalizeAccountTab, roleFilterOptions, type AccountTab } from "./tabs";

export const ACCOUNT_SORTS = [
  "name",
  "role",
  "status",
  "rate",
  "jobs30",
  "qa30",
  "documents",
  "lastSeen",
  "jobsWeek",
  "owed",
  // Cleaner performance figures restored from the old Cleaners roster (parity, 2026-11-12).
  "rating",
  "reliability",
  "attendance",
  "hours30",
] as const;
export type AccountSort = (typeof ACCOUNT_SORTS)[number];

export const ACCOUNT_STATUS_FILTERS = ["all", "active", "invited", "disabled"] as const;
export type AccountStatusFilter = (typeof ACCOUNT_STATUS_FILTERS)[number];

export const ACCOUNT_LIST_MAX_PAGE_SIZE = 100;

/** What the viewer may see in the list. Columns they may not see are not sent. */
export type AccountListVisibility = {
  /** Pay rate. ADMIN and OPS_MANAGER, as on the account page before the redesign. */
  pay: boolean;
  /** Jobs and QA figures from the Quality hub; follows the hub's own access. */
  quality: boolean;
  /**
   * Per-cleaner performance figures the old Cleaners roster showed (customer
   * rating, reliability, attendance, hours 30 d). Follows the workforce pack,
   * the access that roster had. Absent = false (older callers).
   */
  performance?: boolean;
};

export type AccountFilters = {
  tab: AccountTab;
  q: string;
  status: AccountStatusFilter;
  /** Only people whose documents are missing, expired or expiring. */
  documents: boolean;
  role: Role | "";
  /**
   * Only people with no default pay rate (User.hourlyRate unset), `rate=none`.
   * Linked from the Finance figures that leave such cleans uncosted. Applies
   * only when the viewer may see pay.
   */
  noRate?: boolean;
};

export type AccountRow = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: Role;
  extraRoles: Role[];
  status: AccountStatus;
  /** Days since the invitation, while it is not accepted. */
  inviteAgeDays: number | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  clientName: string | null;
  /** Present only when the viewer may see pay. null = no rate set. */
  rate?: number | null;
  /** Present only when the viewer may see quality figures. null = no figure. */
  jobs30?: number | null;
  qa30?: number | null;
  /**
   * Present only when the viewer may see performance figures; null = no
   * figure (not a cleaner, no data in the window, or the read failed or
   * timed out). From lib/workforce/performance, as the old roster read them.
   */
  rating?: number | null;
  reliability?: number | null;
  attendance?: number | null;
  /** Logged hours over the last 30 days (completed time logs). null = could not be read. */
  hours30?: number | null;
  documents: Pick<DocumentState, "kind" | "label">;
  /** Assigned jobs scheduled this Sydney week (Mon–Sun), cancelled excluded. */
  jobsWeek: number;
  /** Approved pay adjustments not yet paid ("Owed"). Present only when the viewer may see pay. */
  owed?: number;
  lastSeenAt: string | null;
  attention: AttentionReason[];
};

export type AccountListSummary = {
  people: number;
  invitesPending: number;
  documentsExpiring: number;
  documentsExpired: number;
  /** People with a requested or required document not on file. */
  documentsMissing?: number;
};

export type AccountListResponse = ListResponse<AccountRow, AccountSort> & {
  tab: AccountTab;
  counts: Record<AccountTab, number>;
  summary: AccountListSummary;
  columns: AccountListVisibility;
};

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

export function parseAccountFilters(source: Source): AccountFilters {
  const tab = normalizeAccountTab(readQueryValue(source, "tab"));
  const rawStatus = readQueryValue(source, "status") ?? "all";
  if (!(ACCOUNT_STATUS_FILTERS as readonly string[]).includes(rawStatus)) {
    throw new ListQueryError(`Unknown status "${rawStatus}". Use all, active, invited or disabled.`, "filter");
  }
  const rawRole = readQueryValue(source, "role") ?? "";
  if (rawRole && !(roleFilterOptions(tab) as readonly string[]).includes(rawRole)) {
    throw new ListQueryError(`The ${tab} tab cannot be filtered by role "${rawRole}".`, "filter");
  }
  const q = (readQueryValue(source, "q") ?? "").slice(0, 120);
  return {
    tab,
    q,
    status: rawStatus as AccountStatusFilter,
    documents: readQueryValue(source, "documents") === "1",
    role: rawRole as Role | "",
    noRate: readQueryValue(source, "rate") === "none",
  };
}

const PERFORMANCE_SORTS: readonly AccountSort[] = ["rating", "reliability", "attendance", "hours30"];

/** Sort columns the viewer can actually see; anything else is refused (400). */
export function sortableFor(visibility: AccountListVisibility): AccountSort[] {
  return ACCOUNT_SORTS.filter((sort) => {
    if (sort === "rate" || sort === "owed") return visibility.pay;
    if (sort === "jobs30" || sort === "qa30") return visibility.quality;
    if (PERFORMANCE_SORTS.includes(sort)) return visibility.performance === true;
    return true;
  });
}

export function parseAccountListQuery(source: Source, visibility: AccountListVisibility): ListQuery<AccountSort> {
  return parseListQuery(source, {
    sortable: sortableFor(visibility),
    defaultSort: "name",
    defaultDir: "asc",
    defaultPageSize: 25,
    maxPageSize: ACCOUNT_LIST_MAX_PAGE_SIZE,
  });
}
