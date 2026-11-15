import "server-only";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { buildInvitationUrl, createUserInvitation, sendInvitationEmail } from "@/lib/auth/invitations";
import { issueRecoveryToken } from "@/lib/auth/recovery";
import { passwordResetEmail, passwordResetLink } from "@/lib/auth/password-reset-email";
import { issueSignupOtp } from "@/lib/auth/registration-otp";
import { officeSendDecision } from "@/lib/notifications/office-send-permission";
import { ACCOUNT_EMAIL_AUDIT_ACTION, recordAccountEmail, type AccountEmailOrigin } from "./account-email-record";
import {
  ACCOUNT_EMAIL_COOL_DOWN_MINUTES,
  ACCOUNT_EMAIL_LABELS,
  ACCOUNT_EMAIL_STATE_LABELS,
  ACCOUNT_EMAIL_TYPES,
  accountEmailIneligibility,
  invitationRevokeIneligibility,
  roleAboveRefusal,
  type AccountEmailState,
  type AccountEmailType,
} from "./account-email-rules";

/**
 * Accounts › Account emails: resend an invitation, a password reset link or a
 * sign-up code, list what was sent, and copy a pending invitation link.
 * Rules: ./account-email-rules.ts. Every send issues a FRESH token or code
 * (the previous one stops working), respects a per-person, per-type
 * cool-down, goes through the existing mail path to the person's own account
 * address only, and is audited with the real sender and the provider's answer.
 */

export class AccountEmailError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The real signed-in sender (never an impersonated identity) and every role they hold. */
export type AccountEmailActor = { id: string; role: "ADMIN" | "OPS_MANAGER"; heldRoles: string[] };

/** ADMIN, or OPS_MANAGER with the Staff accounts pack at manage; never while impersonating. */
export async function resolveAccountEmailActor(session: Session): Promise<AccountEmailActor> {
  const decision = await officeSendDecision(session, "account_email");
  if (!decision.allowed) throw new AccountEmailError(403, decision.reason);
  return { id: session.user.id, role: decision.actorRole, heldRoles: (session.user.heldRoles ?? [session.user.role]).map(String) };
}

const targetSelect = {
  id: true, email: true, name: true, role: true, isActive: true, emailVerified: true,
  extraRoles: { select: { role: true } },
  invitation: { select: { token: true, acceptedAt: true, expiresAt: true, createdAt: true, revokedAt: true } },
} as const;

export async function loadTarget(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: targetSelect });
  if (!user) throw new AccountEmailError(404, "Person not found.");
  return user;
}

export type AccountEmailTarget = Awaited<ReturnType<typeof loadTarget>>;
type Target = AccountEmailTarget;

export function targetRoles(target: Target): string[] {
  return [target.role, ...target.extraRoles.map((row) => row.role)].map(String);
}

export function facts(target: Target) {
  return {
    isActive: target.isActive,
    emailVerified: Boolean(target.emailVerified),
    invitation: target.invitation ? { acceptedAt: target.invitation.acceptedAt, revokedAt: target.invitation.revokedAt } : null,
  };
}

/** Why the actor may not act on this person at all (themselves, a higher role), or null. */
export function personRefusal(actor: AccountEmailActor, target: Target): string | null {
  if (target.id === actor.id) return "Use your own account settings for your own sign-in emails.";
  return roleAboveRefusal(actor.heldRoles, targetRoles(target));
}

/** Why the actor may not send this type to this person now (role, eligibility), or null. */
function refusalFor(actor: AccountEmailActor, target: Target, type: AccountEmailType): string | null {
  if (target.id === actor.id) return "Use your own account settings for your own sign-in emails.";
  return roleAboveRefusal(actor.heldRoles, targetRoles(target)) ?? accountEmailIneligibility(type, facts(target));
}

/** A role refusal is a permission answer (403); anything else is the person's current state (409). */
export function refusalStatus(refusal: string): number {
  return refusal.startsWith("You cannot") ? 403 : 409;
}

async function lastSendWithinCoolDown(userId: string, type: AccountEmailType, now: Date) {
  const since = new Date(now.getTime() - ACCOUNT_EMAIL_COOL_DOWN_MINUTES * 60_000);
  const rows = await db.auditLog.findMany({
    where: { action: ACCOUNT_EMAIL_AUDIT_ACTION, entity: "User", entityId: userId, createdAt: { gte: since }, after: { path: ["type"], equals: type } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { createdAt: true, after: true },
  });
  // A send the provider refused outright can be retried at once; anything that may have gone out cannot.
  return rows.find((row) => {
    const state = (row.after as { state?: unknown } | null)?.state;
    return state !== "NOT_ACCEPTED" && state !== "SKIPPED";
  }) ?? null;
}

export type AccountEmailSendResult = { type: AccountEmailType; to: string; state: AccountEmailState; stateLabel: string; error: string | null };

export async function sendAccountEmail(actor: AccountEmailActor, userId: string, type: AccountEmailType, origin: AccountEmailOrigin, now = new Date()): Promise<AccountEmailSendResult> {
  const target = await loadTarget(userId);
  const refusal = refusalFor(actor, target, type);
  if (refusal) throw new AccountEmailError(refusalStatus(refusal), refusal);
  const recent = await lastSendWithinCoolDown(target.id, type, now);
  if (recent) {
    const next = new Date(recent.createdAt.getTime() + ACCOUNT_EMAIL_COOL_DOWN_MINUTES * 60_000);
    const minutes = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60_000));
    throw new AccountEmailError(429, `${ACCOUNT_EMAIL_LABELS[type].name} was sent less than ${ACCOUNT_EMAIL_COOL_DOWN_MINUTES} minutes ago. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  const to = target.email.toLowerCase();
  const base = { targetUserId: target.id, actorId: actor.id, actorRole: actor.role, type, origin, to };
  let recorded: { state: AccountEmailState; error: string | null };
  if (type === "INVITATION") {
    // A fresh token replaces the old one in the same row (the old link stops working).
    const invite = await createUserInvitation({ userId: target.id, createdById: actor.id });
    const sent = await sendInvitationEmail({ to, name: target.name, role: target.role, url: buildInvitationUrl(invite.token), expiresAt: invite.expiresAt });
    recorded = await recordAccountEmail({ ...base, answer: sent });
  } else if (type === "PASSWORD_RESET") {
    // Issuing deletes the previous reset token for this address.
    const raw = await issueRecoveryToken("pwreset", to);
    const content = passwordResetEmail({ name: target.name, email: to, link: passwordResetLink(to, raw), sentByOffice: true });
    recorded = await recordAccountEmail({ ...base, send: { to, subject: content.subject, html: content.html, transactional: true, critical: true } });
  } else {
    // The code service replaces the previous code and applies its own cool-down too.
    const sent = await issueSignupOtp(to, { enforceCooldown: true });
    if (!sent.ok && !sent.sendAttempted) throw new AccountEmailError(429, sent.error ?? "Try again shortly.");
    recorded = await recordAccountEmail({ ...base, answer: sent.ok ? { ok: true, acceptance: "ACCEPTED", externalId: sent.externalId } : { ok: false, error: sent.error, skipped: sent.skipped, acceptance: sent.acceptance } });
  }
  return { type, to, state: recorded.state, stateLabel: ACCOUNT_EMAIL_STATE_LABELS[recorded.state], error: recorded.error };
}

/** A copy of the pending invitation link (not re-issued, so the emailed link keeps working). Audited. */
export async function copyInvitationLink(actor: AccountEmailActor, userId: string, now = new Date()): Promise<{ link: string; expiresAt: string }> {
  const target = await loadTarget(userId);
  const refusal = refusalFor(actor, target, "INVITATION");
  if (refusal) throw new AccountEmailError(refusalStatus(refusal), refusal);
  const invitation = target.invitation;
  if (invitation?.revokedAt) throw new AccountEmailError(409, "The invitation was withdrawn. Resend the invitation to issue a new link.");
  if (!invitation || invitation.expiresAt.getTime() <= now.getTime()) throw new AccountEmailError(409, "The invitation has expired. Resend the invitation to get a new link.");
  await db.auditLog.create({ data: { userId: actor.id, action: "ACCOUNT_INVITATION_LINK_COPIED", entity: "User", entityId: target.id, after: { actorRole: actor.role, expiresAt: invitation.expiresAt.toISOString() } } });
  return { link: buildInvitationUrl(invitation.token), expiresAt: invitation.expiresAt.toISOString() };
}

export type AccountEmailHistoryEntry = {
  id: string;
  label: string;
  at: string;
  to: string | null;
  state: AccountEmailState;
  stateLabel: string;
  sentBy: string;
  note: string | null;
};

type AuditRow = { id: string; action: string; createdAt: Date; after: unknown; userId: string | null };

const HISTORY_ACTIONS = [ACCOUNT_EMAIL_AUDIT_ACTION, "CREATE_USER", "RESET_USER_PASSWORD", "ACCEPT_INVITATION", "ACCOUNT_INVITATION_LINK_COPIED", "ACCOUNT_INVITATION_REVOKED"];

function legacyState(flag: unknown): AccountEmailState {
  return flag === true ? "ACCEPTED" : flag === false ? "NOT_ACCEPTED" : "NOT_RECORDED";
}

function historyEntry(row: AuditRow, names: Map<string, string>, email: string): AccountEmailHistoryEntry | null {
  const after = (row.after ?? {}) as Record<string, unknown>;
  const by = (id: string | null) => (id ? names.get(id) ?? "Office" : "Office");
  const entry = (label: string, state: AccountEmailState, sentBy: string, to: string | null, note: string | null = null): AccountEmailHistoryEntry => ({
    id: row.id, label, at: row.createdAt.toISOString(), to, state, stateLabel: ACCOUNT_EMAIL_STATE_LABELS[state], sentBy, note,
  });
  switch (row.action) {
    case ACCOUNT_EMAIL_AUDIT_ACTION: {
      const type = ACCOUNT_EMAIL_TYPES.find((value) => value === after.type);
      if (!type) return null;
      const state = (typeof after.state === "string" && after.state in ACCOUNT_EMAIL_STATE_LABELS ? after.state : "NOT_RECORDED") as AccountEmailState;
      const self = after.sentBy === "SELF";
      return entry(ACCOUNT_EMAIL_LABELS[type].name, state, self ? "The person (forgot password)" : by(row.userId), typeof after.to === "string" ? after.to : null, typeof after.error === "string" ? after.error : null);
    }
    case "CREATE_USER":
      if (after.activationMode !== "ADMIN_CREATED_INVITE") return null;
      // Accounts created since 2026-11-16 record the email's answer as its own ACCOUNT_EMAIL_SENT row.
      if (after.emailRecordedSeparately === true) return null;
      return entry("Invitation to set a password (account created)", legacyState(after.invitationEmailSent), by(row.userId), typeof after.email === "string" ? after.email : email);
    case "RESET_USER_PASSWORD":
      if (after.mode === "RESET_LINK") return entry("Password reset link (administrator reset)", legacyState(after.emailSent), by(row.userId), email, "A single-use link that works for 30 minutes.");
      return entry("Temporary password (administrator reset)", legacyState(after.emailSent), by(row.userId), email, "The password itself is never shown here.");
    case "ACCEPT_INVITATION":
      return entry("Invitation accepted", "NOT_RECORDED", "The person", null, "Not an email: the person set their password.");
    case "ACCOUNT_INVITATION_LINK_COPIED":
      return entry("Invitation link copied", "NOT_RECORDED", by(row.userId), null, "Not an email: the office copied the pending link.");
    case "ACCOUNT_INVITATION_REVOKED":
      return entry("Invitation withdrawn", "NOT_RECORDED", by(row.userId), null, "Not an email: the link can no longer be accepted.");
    default:
      return null;
  }
}

export type AccountEmailOption = { type: AccountEmailType; label: string; allowed: boolean; reason: string | null };

export type AccountEmailOverview = {
  email: string;
  invitation: { expiresAt: string; acceptedAt: string | null; expired: boolean; revokedAt: string | null } | null;
  options: AccountEmailOption[];
  canCopyInvitationLink: boolean;
  /** This viewer may withdraw the pending invitation now (owner decision 2026-11-13). */
  canRevokeInvitation: boolean;
  /** Why not, when there is a pending invitation but this viewer may not revoke it. */
  revokeRefusal: string | null;
  history: AccountEmailHistoryEntry[];
  coolDownMinutes: number;
};

/** `actor` is the sender, or why this viewer cannot send (they can still read the history). */
export async function accountEmailOverview(actor: AccountEmailActor | { refused: string }, userId: string, now = new Date()): Promise<AccountEmailOverview> {
  const target = await loadTarget(userId);
  const [rows, clientInvites] = await Promise.all([
    db.auditLog.findMany({ where: { entity: "User", entityId: target.id, action: { in: HISTORY_ACTIONS } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, createdAt: true, after: true, userId: true } }),
    // Client portal access emails are audited on the client, naming this login.
    db.auditLog.findMany({ where: { action: "SEND_CLIENT_INVITE", entity: "Client", after: { path: ["userId"], equals: target.id } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, action: true, createdAt: true, after: true, userId: true } }),
  ]);
  const actorIds = Array.from(new Set([...rows, ...clientInvites].map((row) => row.userId).filter((id): id is string => Boolean(id))));
  const people = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(people.map((person) => [person.id, person.name?.trim() || person.email]));
  const history = [
    ...rows.map((row) => historyEntry(row, names, target.email)).filter((row): row is AccountEmailHistoryEntry => Boolean(row)),
    ...clientInvites.map((row): AccountEmailHistoryEntry => ({
      id: row.id, label: "Client portal access (temporary password)", at: row.createdAt.toISOString(),
      to: typeof (row.after as { email?: unknown } | null)?.email === "string" ? String((row.after as { email: string }).email) : target.email,
      state: "NOT_RECORDED", stateLabel: ACCOUNT_EMAIL_STATE_LABELS.NOT_RECORDED, sentBy: names.get(row.userId ?? "") ?? "Office", note: "The provider's answer was not recorded for this email.",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const options: AccountEmailOption[] = ACCOUNT_EMAIL_TYPES.map((type) => {
    const reason = "refused" in actor ? actor.refused : refusalFor(actor, target, type);
    return { type, label: ACCOUNT_EMAIL_LABELS[type].button, allowed: reason === null, reason };
  });
  const invitation = target.invitation
    ? {
        expiresAt: target.invitation.expiresAt.toISOString(),
        acceptedAt: target.invitation.acceptedAt?.toISOString() ?? null,
        expired: target.invitation.expiresAt.getTime() <= now.getTime(),
        revokedAt: target.invitation.revokedAt?.toISOString() ?? null,
      }
    : null;
  const inviteOption = options.find((option) => option.type === "INVITATION");
  const revokeState = invitationRevokeIneligibility(facts(target));
  const revokeRefusal = revokeState ? null : "refused" in actor ? actor.refused : personRefusal(actor, target);
  return {
    email: target.email,
    invitation,
    options,
    canCopyInvitationLink: Boolean(inviteOption?.allowed && invitation && !invitation.expired && !invitation.revokedAt),
    canRevokeInvitation: revokeState === null && revokeRefusal === null,
    revokeRefusal,
    history,
    coolDownMinutes: ACCOUNT_EMAIL_COOL_DOWN_MINUTES,
  };
}

