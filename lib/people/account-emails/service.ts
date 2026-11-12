/**
 * Loads the account emails list: every person with an invitation or a
 * recorded account email in the last year, their most recent email, and this
 * viewer's rights (the same as the person panel's resend). A fixed number of
 * batched queries; rows are built by ./derive.
 */
import "server-only";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { ACCOUNT_EMAIL_AUDIT_ACTION } from "@/lib/accounts/account-email-record";
import { ACCOUNT_EMAIL_STATE_LABELS, ACCOUNT_EMAIL_TYPES, type AccountEmailState } from "@/lib/accounts/account-email-rules";
import { AccountEmailError, resolveAccountEmailActor } from "@/lib/accounts/account-emails";
import type { ListQuery } from "@/lib/admin/list-query";
import { buildEmailListResponse, buildEmailRow, type EmailRecordFact, type EmailViewer, type PersonEmailFacts } from "./derive";
import type { AccountEmailKind, AccountEmailListFilters, AccountEmailListResponse, AccountEmailListRow, AccountEmailListSort } from "./types";

const ACTIONS = [ACCOUNT_EMAIL_AUDIT_ACTION, "CREATE_USER", "RESET_USER_PASSWORD", "SEND_CLIENT_INVITE"];
const LOOKBACK_DAYS = 365;

type AuditRow = { action: string; createdAt: Date; after: unknown; userId: string | null; entityId: string | null };

function legacyState(flag: unknown): AccountEmailState {
  return flag === true ? "ACCEPTED" : flag === false ? "NOT_ACCEPTED" : "NOT_RECORDED";
}

/** The person an audit row is about and what it recorded, or null when it is not an account email. */
function readRecord(row: AuditRow): { userId: string; kind: AccountEmailKind; state: AccountEmailState; self: boolean } | null {
  const after = (row.after ?? {}) as Record<string, unknown>;
  switch (row.action) {
    case ACCOUNT_EMAIL_AUDIT_ACTION: {
      const type = ACCOUNT_EMAIL_TYPES.find((value) => value === after.type);
      if (!type || !row.entityId) return null;
      const state = (typeof after.state === "string" && after.state in ACCOUNT_EMAIL_STATE_LABELS ? after.state : "NOT_RECORDED") as AccountEmailState;
      return { userId: row.entityId, kind: type, state, self: after.sentBy === "SELF" };
    }
    case "CREATE_USER":
      if (after.activationMode !== "ADMIN_CREATED_INVITE" || !row.entityId) return null;
      return { userId: row.entityId, kind: "INVITATION", state: legacyState(after.invitationEmailSent), self: false };
    case "RESET_USER_PASSWORD":
      return row.entityId ? { userId: row.entityId, kind: "TEMPORARY_PASSWORD", state: legacyState(after.emailSent), self: false } : null;
    case "SEND_CLIENT_INVITE":
      return typeof after.userId === "string" ? { userId: after.userId, kind: "CLIENT_PORTAL", state: "NOT_RECORDED", self: false } : null;
    default:
      return null;
  }
}

async function resolveViewer(session: Session): Promise<{ viewer: EmailViewer; refusal: string | null }> {
  try {
    const actor = await resolveAccountEmailActor(session);
    return { viewer: { id: actor.id, heldRoles: actor.heldRoles }, refusal: null };
  } catch (error) {
    if (error instanceof AccountEmailError) return { viewer: { refused: error.message }, refusal: error.message };
    throw error;
  }
}

export async function loadAccountEmailRows(session: Session, now: Date = new Date()): Promise<{ rows: AccountEmailListRow[]; resets: { total: number; byOffice: number }; viewerRefusal: string | null }> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [{ viewer, refusal }, audits, invited] = await Promise.all([
    resolveViewer(session),
    db.auditLog.findMany({ where: { action: { in: ACTIONS }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { action: true, createdAt: true, after: true, userId: true, entityId: true } }),
    db.userInvitation.findMany({ select: { userId: true } }),
  ]);

  const latest = new Map<string, { record: NonNullable<ReturnType<typeof readRecord>>; row: AuditRow }>();
  let resetsTotal = 0;
  let resetsByOffice = 0;
  for (const row of audits) {
    const record = readRecord(row);
    if (!record) continue;
    if ((record.kind === "PASSWORD_RESET" || record.kind === "TEMPORARY_PASSWORD") && row.createdAt >= weekAgo) {
      resetsTotal += 1;
      if (!record.self) resetsByOffice += 1;
    }
    // Rows are newest first: the first record per person is their latest.
    if (!latest.has(record.userId)) latest.set(record.userId, { record, row });
  }

  const userIds = Array.from(new Set([...Array.from(latest.keys()), ...invited.map((row) => row.userId)]));
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true, name: true, email: true, role: true, isActive: true, emailVerified: true, lastSeenAt: true,
          extraRoles: { select: { role: true } },
          client: { select: { name: true } },
          vaTeam: { select: { name: true, client: { select: { name: true } } } },
          invitation: { select: { createdAt: true, acceptedAt: true, expiresAt: true, createdById: true, createdBy: { select: { name: true, email: true } } } },
        },
      })
    : [];
  const actorIds = Array.from(new Set(Array.from(latest.values()).map((entry) => entry.row.userId).filter((id): id is string => Boolean(id))));
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
  const actorName = new Map(actors.map((actor) => [actor.id, actor.name?.trim() || actor.email]));

  const rows = users.map((user) => {
    const entry = latest.get(user.id);
    const record: EmailRecordFact | null = entry
      ? {
          kind: entry.record.kind,
          at: entry.row.createdAt,
          actorId: entry.record.self ? null : entry.row.userId,
          actorName: entry.record.self ? "The person" : actorName.get(entry.row.userId ?? "") ?? "Office",
          state: entry.record.state,
        }
      : null;
    const context = user.role === "VA" && user.vaTeam ? `Assistant · ${user.vaTeam.client.name}` : user.role === "CLIENT" && user.client ? `Client · ${user.client.name}` : null;
    const facts: PersonEmailFacts = {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roles: [user.role, ...user.extraRoles.map((row) => row.role)],
      isActive: user.isActive,
      emailVerified: Boolean(user.emailVerified),
      lastSeenAt: user.lastSeenAt,
      context,
      invitation: user.invitation
        ? { createdAt: user.invitation.createdAt, acceptedAt: user.invitation.acceptedAt, expiresAt: user.invitation.expiresAt, createdById: user.invitation.createdById, createdByName: user.invitation.createdBy ? user.invitation.createdBy.name?.trim() || user.invitation.createdBy.email : null }
        : null,
      latest: record,
    };
    return buildEmailRow(facts, viewer, now);
  });
  return { rows, resets: { total: resetsTotal, byOffice: resetsByOffice }, viewerRefusal: refusal };
}

export async function listAccountEmails(session: Session, filters: AccountEmailListFilters, query: ListQuery<AccountEmailListSort>, now: Date = new Date()): Promise<AccountEmailListResponse> {
  const { rows, resets, viewerRefusal } = await loadAccountEmailRows(session, now);
  return buildEmailListResponse(rows, filters, query, { resets, viewerRefusal }, now);
}
