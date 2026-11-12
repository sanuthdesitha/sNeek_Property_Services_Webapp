/**
 * Pure rules for the account emails list: one row per person from their most
 * recent account email and invitation, the next step and whether this viewer
 * may take it (the same rules as the person panel's resend:
 * lib/accounts/account-email-rules.ts), filters, counts, sorting and paging.
 */
import { listResponse, type ListQuery } from "@/lib/admin/list-query";
import { accountEmailIneligibility, roleAboveRefusal, type AccountEmailState } from "@/lib/accounts/account-email-rules";
import {
  ACCOUNT_EMAIL_KINDS,
  EMAIL_STATE_FILTERS,
  type AccountEmailKind,
  type AccountEmailListFigures,
  type AccountEmailListFilters,
  type AccountEmailListResponse,
  type AccountEmailListRow,
  type AccountEmailListSort,
  type AccountEmailNextStep,
  type EmailStateFilter,
} from "./types";

export type EmailRecordFact = { kind: AccountEmailKind; at: Date; actorId: string | null; actorName: string; state: AccountEmailState };

export type PersonEmailFacts = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  roles: string[];
  isActive: boolean;
  emailVerified: boolean;
  lastSeenAt: Date | null;
  context: string | null;
  invitation: { createdAt: Date; acceptedAt: Date | null; expiresAt: Date; createdByName: string | null; createdById: string | null } | null;
  /** Most recent recorded account email, if any. */
  latest: EmailRecordFact | null;
};

/** The sender, or why this viewer may not send account emails at all. */
export type EmailViewer = { id: string; heldRoles: string[] } | { refused: string };

function nextStepFor(facts: PersonEmailFacts, now: Date): AccountEmailNextStep {
  if (!facts.isActive) return null;
  if (facts.invitation && !facts.invitation.acceptedAt) return facts.invitation.expiresAt.getTime() <= now.getTime() ? "NEW_INVITATION" : "RESEND_INVITATION";
  if (!facts.invitation && !facts.emailVerified && facts.latest?.kind === "SIGNUP_CODE") return "RESEND_SIGNUP_CODE";
  return null;
}

function refusalFor(viewer: EmailViewer, facts: PersonEmailFacts, step: AccountEmailNextStep): string | null {
  if ("refused" in viewer) return viewer.refused;
  if (facts.userId === viewer.id) return "Use your own account settings for your own sign-in emails.";
  const roleRefusal = roleAboveRefusal(viewer.heldRoles, facts.roles);
  if (roleRefusal) return roleRefusal;
  if (!step) return null;
  const type = step === "RESEND_SIGNUP_CODE" ? "SIGNUP_CODE" : "INVITATION";
  return accountEmailIneligibility(type, { isActive: facts.isActive, emailVerified: facts.emailVerified, invitation: facts.invitation ? { acceptedAt: facts.invitation.acceptedAt } : null });
}

export function buildEmailRow(facts: PersonEmailFacts, viewer: EmailViewer, now: Date): AccountEmailListRow {
  const invitation = facts.invitation;
  const pending = Boolean(invitation && !invitation.acceptedAt);
  const expired = Boolean(pending && invitation && invitation.expiresAt.getTime() <= now.getTime());
  const inviteKind: AccountEmailKind = facts.role === "VA" ? "ASSISTANT_ACCESS" : "INVITATION";
  // The invitation row is newer than any recorded email when it was re-issued elsewhere (e.g. the assistants screen).
  const useInvitation = invitation && (!facts.latest || invitation.createdAt.getTime() > facts.latest.at.getTime());
  const kind = useInvitation ? inviteKind : facts.latest?.kind === "INVITATION" ? inviteKind : (facts.latest?.kind ?? inviteKind);
  const sentAt = useInvitation && invitation ? invitation.createdAt : facts.latest?.at ?? now;
  const signedInAt = facts.lastSeenAt ?? invitation?.acceptedAt ?? null;
  const step = nextStepFor(facts, now);
  const refusal = refusalFor(viewer, facts, step);
  const delivery: AccountEmailState = useInvitation ? "NOT_RECORDED" : facts.latest?.state ?? "NOT_RECORDED";
  const notSent = delivery === "NOT_ACCEPTED" || delivery === "SKIPPED";
  return {
    userId: facts.userId,
    name: facts.name,
    email: facts.email,
    role: facts.role,
    context: facts.context,
    kind,
    sentAt: sentAt.toISOString(),
    sentBy: useInvitation ? invitation?.createdByName ?? "System" : facts.latest?.actorName ?? "System",
    sentById: useInvitation ? invitation?.createdById ?? null : facts.latest?.actorId ?? null,
    delivery,
    expiresAt: pending && invitation ? invitation.expiresAt.toISOString() : null,
    expired,
    signedInAt: signedInAt ? signedInAt.toISOString() : null,
    neverSignedIn: !signedInAt,
    needsAction: facts.isActive && (pending || notSent),
    nextStep: step,
    canResend: step !== null && refusal === null,
    canCopyLink: pending && !expired && refusal === null,
    refusal,
  };
}

export function matchesState(row: AccountEmailListRow, state: EmailStateFilter): boolean {
  switch (state) {
    case "all":
      return true;
    case "needs-action":
      return row.needsAction;
    case "never-signed-in":
      return row.neverSignedIn;
    case "expired":
      return row.expired;
    case "not-sent":
      return row.delivery === "NOT_ACCEPTED" || row.delivery === "SKIPPED";
  }
}

const PERIOD_DAYS = { "30d": 30, "90d": 90, all: null } as const;

function inPeriod(row: AccountEmailListRow, filters: AccountEmailListFilters, now: Date): boolean {
  const days = PERIOD_DAYS[filters.period];
  // Something still waiting (a pending invitation) stays listed whatever its age.
  return days === null || row.expiresAt !== null || Date.parse(row.sentAt) >= now.getTime() - days * 86_400_000;
}

function matchesSearch(row: AccountEmailListRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || `${row.name ?? ""} ${row.email} ${row.context ?? ""}`.toLowerCase().includes(needle);
}

/** Rows within the period, search and sender (the base the chip counts describe). */
export function baseEmailRows(rows: AccountEmailListRow[], filters: AccountEmailListFilters, now: Date): AccountEmailListRow[] {
  return rows.filter((row) => inPeriod(row, filters, now) && matchesSearch(row, filters.q) && (!filters.sentBy || row.sentById === filters.sentBy));
}

export function filterEmailRows(rows: AccountEmailListRow[], filters: AccountEmailListFilters, now: Date): AccountEmailListRow[] {
  return baseEmailRows(rows, filters, now).filter((row) => (!filters.kind || row.kind === filters.kind) && matchesState(row, filters.state));
}

const DELIVERY_ORDER: Record<AccountEmailState, number> = { NOT_ACCEPTED: 0, SKIPPED: 1, UNKNOWN: 2, NOT_RECORDED: 3, ACCEPTED: 4 };

function sortValue(row: AccountEmailListRow, sort: AccountEmailListSort): string | number | null {
  switch (sort) {
    case "recipient":
      return (row.name ?? row.email).toLowerCase();
    case "kind":
      return row.kind;
    case "sent":
      return row.sentAt;
    case "delivery":
      return DELIVERY_ORDER[row.delivery];
    case "expires":
      return row.expiresAt;
    case "signedIn":
      return row.signedInAt;
  }
}

export function sortEmailRows(rows: AccountEmailListRow[], sort: AccountEmailListSort, dir: "asc" | "desc"): AccountEmailListRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort);
    const right = sortValue(b, sort);
    if (left === null && right === null) return a.userId.localeCompare(b.userId);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left < right) return -1 * factor;
    if (left > right) return 1 * factor;
    return a.userId.localeCompare(b.userId);
  });
}

export function emailCounts(base: AccountEmailListRow[]) {
  const kindCounts = Object.fromEntries(ACCOUNT_EMAIL_KINDS.map((kind) => [kind, base.filter((row) => row.kind === kind).length])) as Record<AccountEmailKind, number>;
  const stateCounts = Object.fromEntries(EMAIL_STATE_FILTERS.map((state) => [state, base.filter((row) => matchesState(row, state)).length])) as Record<EmailStateFilter, number>;
  return { kindCounts, stateCounts };
}

export function emailFigures(rows: AccountEmailListRow[], resets: { total: number; byOffice: number }, now: Date): AccountEmailListFigures {
  const never = rows.filter((row) => row.neverSignedIn && row.expiresAt === null);
  const oldest = never.reduce<number | null>((max, row) => {
    const days = Math.floor((now.getTime() - Date.parse(row.sentAt)) / 86_400_000);
    return max === null || days > max ? days : max;
  }, null);
  return {
    notAccepted: rows.filter((row) => row.expiresAt !== null).length,
    expired: rows.filter((row) => row.expired).length,
    neverSignedIn: never.length,
    oldestNeverSignedInDays: oldest,
    passwordResets7d: resets.total,
    passwordResetsByOffice7d: resets.byOffice,
  };
}

export function buildEmailListResponse(
  rows: AccountEmailListRow[],
  filters: AccountEmailListFilters,
  query: ListQuery<AccountEmailListSort>,
  extras: { resets: { total: number; byOffice: number }; viewerRefusal: string | null },
  now: Date,
): AccountEmailListResponse {
  const base = baseEmailRows(rows, filters, now);
  const filtered = sortEmailRows(filterEmailRows(rows, filters, now), query.sort, query.dir);
  const senders = new Map<string, string>();
  for (const row of rows) if (row.sentById) senders.set(row.sentById, row.sentBy);
  return {
    ...listResponse(filtered.slice(query.skip, query.skip + query.take), filtered.length, query),
    ...emailCounts(base),
    figures: emailFigures(rows, extras.resets, now),
    senders: Array.from(senders, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    viewerRefusal: extras.viewerRefusal,
  };
}
