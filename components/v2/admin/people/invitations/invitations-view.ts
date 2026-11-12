/**
 * People › Invitations view state in the URL (type, state, search, sender,
 * period, sort, page and the open person). Pure.
 */
import {
  ACCOUNT_EMAIL_KINDS,
  ACCOUNT_EMAIL_LIST_SORTS,
  EMAIL_PERIODS,
  EMAIL_STATE_FILTERS,
  type AccountEmailKind,
  type AccountEmailListSort,
  type EmailPeriod,
  type EmailStateFilter,
} from "@/lib/people/account-emails/types";

export type InvitationsView = {
  kind: AccountEmailKind | "";
  state: EmailStateFilter;
  q: string;
  sentBy: string;
  period: EmailPeriod;
  sort: AccountEmailListSort;
  dir: "asc" | "desc";
  page: number;
  open: string | null;
};

export const DEFAULT_INVITATIONS_VIEW: InvitationsView = { kind: "", state: "needs-action", q: "", sentBy: "", period: "30d", sort: "sent", dir: "desc", page: 1, open: null };
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function readInvitationsView(search: string): InvitationsView {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page") ?? "1");
  const open = params.get("open");
  const sentBy = params.get("sentBy") ?? "";
  return {
    kind: pick(params.get("kind"), ACCOUNT_EMAIL_KINDS, "" as AccountEmailKind) || "",
    state: pick(params.get("state"), EMAIL_STATE_FILTERS, DEFAULT_INVITATIONS_VIEW.state),
    q: params.get("q") ?? "",
    sentBy: ID_PATTERN.test(sentBy) ? sentBy : "",
    period: pick(params.get("period"), EMAIL_PERIODS, DEFAULT_INVITATIONS_VIEW.period),
    sort: pick(params.get("sort"), ACCOUNT_EMAIL_LIST_SORTS, DEFAULT_INVITATIONS_VIEW.sort),
    dir: params.get("dir") === "asc" ? "asc" : "desc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    open: open && ID_PATTERN.test(open) ? open : null,
  };
}

export function invitationsListQuery(view: InvitationsView, pageSize = 25): string {
  const params = new URLSearchParams({ state: view.state, period: view.period, sort: view.sort, dir: view.dir, page: String(view.page), pageSize: String(pageSize) });
  if (view.kind) params.set("kind", view.kind);
  if (view.q.trim()) params.set("q", view.q.trim());
  if (view.sentBy) params.set("sentBy", view.sentBy);
  return params.toString();
}

export function invitationsViewSearch(view: InvitationsView): string {
  const params = new URLSearchParams({ tab: "invitations" });
  const defaults = DEFAULT_INVITATIONS_VIEW;
  if (view.kind) params.set("kind", view.kind);
  if (view.state !== defaults.state) params.set("state", view.state);
  if (view.q) params.set("q", view.q);
  if (view.sentBy) params.set("sentBy", view.sentBy);
  if (view.period !== defaults.period) params.set("period", view.period);
  if (view.sort !== defaults.sort || view.dir !== defaults.dir) {
    params.set("sort", view.sort);
    params.set("dir", view.dir);
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.open) params.set("open", view.open);
  return `?${params.toString()}`;
}

export function patchInvitationsView(current: InvitationsView, patch: Partial<InvitationsView>): InvitationsView {
  const resetsPage = ["kind", "state", "q", "sentBy", "period", "sort", "dir"].some((key) => key in patch);
  return { ...current, ...patch, page: patch.page ?? (resetsPage ? 1 : current.page) };
}
