/**
 * People › Invitations: the account emails list (one row per person, showing
 * their most recent account email), built on the audit rows the account email
 * paths already write (lib/accounts/account-email-record.ts and the older
 * CREATE_USER / RESET_USER_PASSWORD / SEND_CLIENT_INVITE rows) and on each
 * person's invitation. PLAIN module, shared by the route, the rules and the
 * screen.
 *
 * Delivery is only what was recorded: "Accepted by the email provider" is not
 * delivered; older rows without an answer are "Not recorded". Opened and
 * bounced are not stored for account emails, so they are never shown.
 */
import { ListQueryError, parseListQuery, readQueryValue, type ListQuery, type ListResponse } from "@/lib/admin/list-query";
import type { AccountEmailState } from "@/lib/accounts/account-email-rules";

export const ACCOUNT_EMAIL_KINDS = ["INVITATION", "ASSISTANT_ACCESS", "SIGNUP_CODE", "PASSWORD_RESET", "TEMPORARY_PASSWORD", "CLIENT_PORTAL"] as const;
export type AccountEmailKind = (typeof ACCOUNT_EMAIL_KINDS)[number];

export const ACCOUNT_EMAIL_KIND_LABEL: Record<AccountEmailKind, string> = {
  INVITATION: "Invitation",
  ASSISTANT_ACCESS: "Assistant access",
  SIGNUP_CODE: "Sign-up code",
  PASSWORD_RESET: "Password reset link",
  TEMPORARY_PASSWORD: "Temporary password",
  CLIENT_PORTAL: "Client portal",
};

export const DELIVERY_LABEL: Record<AccountEmailState, string> = {
  ACCEPTED: "Accepted",
  NOT_ACCEPTED: "Not sent",
  UNKNOWN: "Unknown",
  SKIPPED: "Not sent",
  NOT_RECORDED: "Not recorded",
};

export const EMAIL_STATE_FILTERS = ["all", "needs-action", "never-signed-in", "expired", "not-sent"] as const;
export type EmailStateFilter = (typeof EMAIL_STATE_FILTERS)[number];

export const EMAIL_PERIODS = ["30d", "90d", "all"] as const;
export type EmailPeriod = (typeof EMAIL_PERIODS)[number];

export const ACCOUNT_EMAIL_LIST_SORTS = ["recipient", "kind", "sent", "delivery", "expires", "signedIn"] as const;
export type AccountEmailListSort = (typeof ACCOUNT_EMAIL_LIST_SORTS)[number];

/** The one next step a row offers (board: one button per row). */
export type AccountEmailNextStep = "RESEND_INVITATION" | "NEW_INVITATION" | "RESEND_SIGNUP_CODE" | null;

export type AccountEmailListRow = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  /** "Assistant · Harbour View", "Client · Northside Lets". */
  context: string | null;
  kind: AccountEmailKind;
  sentAt: string;
  /** Name of the office sender; "System" or "The person" when not the office. */
  sentBy: string;
  sentById: string | null;
  delivery: AccountEmailState;
  /** Pending invitation expiry (ISO), or null. */
  expiresAt: string | null;
  expired: boolean;
  /** The invitation was accepted, or the person has signed in. */
  signedInAt: string | null;
  neverSignedIn: boolean;
  needsAction: boolean;
  nextStep: AccountEmailNextStep;
  /** Server-decided: this viewer may send the next step to this person now. */
  canResend: boolean;
  /** A still-valid invitation link exists and this viewer may copy it. */
  canCopyLink: boolean;
  /** Why the viewer cannot act, when they cannot. */
  refusal: string | null;
};

export type AccountEmailListFigures = {
  notAccepted: number;
  expired: number;
  neverSignedIn: number;
  oldestNeverSignedInDays: number | null;
  passwordResets7d: number;
  passwordResetsByOffice7d: number;
};

export type AccountEmailListResponse = ListResponse<AccountEmailListRow, AccountEmailListSort> & {
  kindCounts: Record<AccountEmailKind, number>;
  stateCounts: Record<EmailStateFilter, number>;
  figures: AccountEmailListFigures;
  senders: Array<{ id: string; name: string }>;
  /** Why this viewer cannot send at all (they can still read), or null. */
  viewerRefusal: string | null;
};

export type AccountEmailListFilters = {
  kind: AccountEmailKind | "";
  state: EmailStateFilter;
  q: string;
  sentBy: string;
  period: EmailPeriod;
};

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

export function parseAccountEmailListFilters(source: Source): AccountEmailListFilters {
  const kind = readQueryValue(source, "kind") ?? "";
  if (kind && !(ACCOUNT_EMAIL_KINDS as readonly string[]).includes(kind)) throw new ListQueryError(`Unknown email type "${kind}".`, "filter");
  const state = readQueryValue(source, "state") ?? "all";
  if (!(EMAIL_STATE_FILTERS as readonly string[]).includes(state)) throw new ListQueryError(`Unknown state "${state}".`, "filter");
  const period = readQueryValue(source, "period") ?? "30d";
  if (!(EMAIL_PERIODS as readonly string[]).includes(period)) throw new ListQueryError(`Unknown period "${period}".`, "filter");
  return {
    kind: kind as AccountEmailKind | "",
    state: state as EmailStateFilter,
    q: (readQueryValue(source, "q") ?? "").slice(0, 120),
    sentBy: (readQueryValue(source, "sentBy") ?? "").slice(0, 128),
    period: period as EmailPeriod,
  };
}

export function parseAccountEmailListQuery(source: Source): ListQuery<AccountEmailListSort> {
  return parseListQuery(source, { sortable: ACCOUNT_EMAIL_LIST_SORTS, defaultSort: "sent", defaultDir: "desc", defaultPageSize: 25, maxPageSize: 100 });
}
