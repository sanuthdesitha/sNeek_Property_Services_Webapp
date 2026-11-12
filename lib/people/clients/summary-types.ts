/**
 * One client's summary for the People side panel and the client page's key
 * facts. PLAIN module (types only), shared by the route, the service and the
 * screens. Unknown figures are null, never 0.
 */

export type ClientInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  status: string;
  /** Amount still owed (total less payments and credits). */
  owing: number;
  /** Calendar day the invoice is due (its own terms, organisation timezone). */
  dueDay: string;
  overdue: boolean;
  /** Whole days past due (0 when not overdue). */
  daysOverdue: number;
};

export type ClientPropertySummary = {
  id: string;
  name: string;
  suburb: string | null;
  /** ISO time of the next booked clean (not cancelled, not finished), or null. */
  nextCleanAt: string | null;
  nextCleanUnassigned: boolean;
  lastCleanAt: string | null;
  /** The last clean is waiting for QA review. */
  awaitingReview: boolean;
  /** Turnover (AIRBNB_TURNOVER) client rate, or null when none is set. */
  turnoverRate: number | null;
  calendar: "SYNCED" | "FAILED" | "NOT_CONNECTED" | "DISABLED";
  calendarFailedSince: string | null;
};

export type ClientLoginSummary = {
  id: string;
  name: string | null;
  email: string;
  isActive: boolean;
  invited: boolean;
  lastSeenAt: string | null;
};

export type ClientTeamSummary = {
  id: string;
  name: string;
  isActive: boolean;
  members: number;
  /** Null = every property of the client. */
  propertyCount: number | null;
};

export type ClientAttentionItem = { kind: "INVOICE" | "CASE" | "QUOTE"; label: string; href: string };

export type ClientSummary = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  suburb: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  terms: { days: number; source: "CLIENT" | "DEFAULT" };
  money: {
    owing: number | null;
    overdue: number | null;
    invoices: ClientInvoiceSummary[];
    /** Trailing 12 months from the Finance engine; null when not readable. */
    revenue12: number | null;
    cleanerCost12: number | null;
    margin12: number | null;
    marginPct12: number | null;
  } | null;
  properties: ClientPropertySummary[];
  logins: ClientLoginSummary[];
  teams: ClientTeamSummary[];
  attention: ClientAttentionItem[];
};
