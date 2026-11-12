/**
 * People › Clients: shapes and the query contract for the client business
 * list (`GET /api/admin/clients/directory`). PLAIN module (no server imports):
 * shared by the route, the pure rules in ./derive and the screen.
 *
 * Money figures reuse the Finance definitions (lib/finance/receivables,
 * lib/billing/client-invoice-list): owing = SENT and PART_PAID invoices less
 * payments and approved/sent credit notes, fully credited invoices not
 * counted; overdue = past the invoice's own due day; paid this month = PAID
 * invoices whose paid stamp is in this calendar month (organisation
 * timezone). A figure that could not be read is null, never 0.
 */
import { ListQueryError, parseListQuery, readQueryValue, type ListQuery, type ListResponse } from "@/lib/admin/list-query";

export const CLIENT_DIRECTORY_SORTS = ["name", "properties", "logins", "invoicesOpen", "owing", "lastClean", "status"] as const;
export type ClientDirectorySort = (typeof CLIENT_DIRECTORY_SORTS)[number];

/** Chips as drawn. `all` = every client. */
export const CLIENT_DIRECTORY_FILTERS = ["all", "active", "inactive", "owing", "overdue", "no-login", "assistants", "attention"] as const;
export type ClientDirectoryFilter = (typeof CLIENT_DIRECTORY_FILTERS)[number];

export const CLIENT_DIRECTORY_FILTER_LABEL: Record<ClientDirectoryFilter, string> = {
  all: "All clients",
  active: "Active",
  inactive: "Inactive",
  owing: "Owing",
  overdue: "Overdue",
  "no-login": "No portal login",
  assistants: "Has assistants",
  attention: "Needs attention",
};

export const DEFAULT_CLIENT_FILTER: ClientDirectoryFilter = "active";
export const CLIENT_DIRECTORY_MAX_PAGE_SIZE = 100;

/** Why a client is in "Needs attention". */
export type ClientAttentionReason = "OVERDUE" | "NO_LOGIN";

export type ClientDirectoryRow = {
  id: string;
  name: string;
  suburb: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  /** Active properties. */
  properties: number;
  /** Active CLIENT logins linked to this client. */
  logins: number;
  /** Client logins invited and not yet accepted. */
  loginsInvited: number;
  /** Active assistant (VA) logins on this client's teams. */
  assistants: number;
  /** Money: present only when the viewer may see client money. */
  invoicesOpen?: number;
  owing?: number | null;
  overdue?: number | null;
  overdueCount?: number;
  paidThisMonth?: number | null;
  /** Calendar day (organisation timezone) of the last finished clean, or null. */
  lastCleanDay: string | null;
  attention: ClientAttentionReason[];
};

export type ClientDirectoryVisibility = {
  /**
   * Owing, invoices open, overdue and paid this month. Everyone admitted to
   * Clients saw "Paid · MTD" on the list and "Outstanding" on the client page
   * before the redesign, so this stays true for them (unchanged rule).
   */
  money: boolean;
};

export type ClientDirectoryFigures = {
  totalClients: number;
  activeProperties: number;
  /** Null when hidden or unreadable. */
  outstanding: number | null;
  overdue: number | null;
  paidThisMonth: number | null;
};

export type ClientDirectoryResponse = ListResponse<ClientDirectoryRow, ClientDirectorySort> & {
  filter: ClientDirectoryFilter;
  counts: Record<ClientDirectoryFilter, number>;
  figures: ClientDirectoryFigures;
  columns: ClientDirectoryVisibility;
};

export type ClientDirectoryFilters = { filter: ClientDirectoryFilter; q: string };

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

export function parseClientDirectoryFilters(source: Source): ClientDirectoryFilters {
  const raw = readQueryValue(source, "filter") ?? DEFAULT_CLIENT_FILTER;
  if (!(CLIENT_DIRECTORY_FILTERS as readonly string[]).includes(raw)) {
    throw new ListQueryError(`Unknown filter "${raw}".`, "filter");
  }
  return { filter: raw as ClientDirectoryFilter, q: (readQueryValue(source, "q") ?? "").slice(0, 120) };
}

export function clientSortableFor(visibility: ClientDirectoryVisibility): ClientDirectorySort[] {
  return CLIENT_DIRECTORY_SORTS.filter((sort) => visibility.money || (sort !== "owing" && sort !== "invoicesOpen"));
}

export function parseClientDirectoryQuery(source: Source, visibility: ClientDirectoryVisibility): ListQuery<ClientDirectorySort> {
  return parseListQuery(source, {
    sortable: clientSortableFor(visibility),
    defaultSort: "name",
    defaultDir: "asc",
    defaultPageSize: 25,
    maxPageSize: CLIENT_DIRECTORY_MAX_PAGE_SIZE,
  });
}
