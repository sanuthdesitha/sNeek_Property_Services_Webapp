import "server-only";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  buildInvitationUrl,
  generateInvitationToken,
  INVITATION_LIFETIME_DAYS,
  sendInvitationEmail,
} from "@/lib/auth/invitations";
import { upsertAuthUserState } from "@/lib/auth/account-state";
import { upsertUserExtendedProfile } from "@/lib/accounts/user-details";
import { recordAccountEmail, ACCOUNT_EMAIL_AUDIT_ACTION } from "@/lib/accounts/account-email-record";
import { assignNewManagerPacks } from "@/lib/rbac/ops-access";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { autoAssignCleanerLearning, ensureDefaultLearningPaths } from "@/lib/workforce/service";
import {
  emailInUseMessage,
  type AccountCreateOutcome,
  type ExistingAccountFacts,
  type InvitationEmailState,
  type InvitationSmsState,
} from "./create-account-rules";

/**
 * The ONE way a staff account (and a client portal login) is created
 * (boards "Invite person", "Hiring application", "Add client", 2026-11-16).
 *
 * In one transaction: the email check, the account row (an unusable password
 * hash until the person accepts), its single-use invitation (the same
 * `UserInvitation` row Resend, Copy link and Revoke use), starting permission
 * packs for an operations manager, the caller's own link (a hired application,
 * a new client) and the CREATE_USER audit row with the actual actor. After
 * the commit: profile extras, sign-in state, learning, then the invitation
 * email through the existing designed invitation email
 * (`sendInvitationEmail` → `buildDesignedEmail("accountInvitationLink")`)
 * and, only when ticked, one SMS with the link. The provider's answer is
 * recorded (ACCOUNT_EMAIL_SENT); accepted is never reported as delivered.
 *
 * Idempotent: a repeat with the same idempotency key from the same actor
 * returns the first result (no second account, no second email).
 * Never returns or logs the token or a password.
 */

export class AccountCreateError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: "EMAIL_IN_USE" | "INVALID" | "CONFLICT" = "INVALID",
    readonly existing: ExistingAccountFacts | null = null,
  ) {
    super(message);
  }
}

export type AccountCreateOrigin = "INVITE_PERSON" | "HIRING" | "ADD_CLIENT" | "USERS_API";

export type AccountCreateInput = {
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  clientId?: string | null;
  abn?: string | null;
  businessName?: string | null;
  address?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  baseLocation?: string | null;
  contactNumber?: string | null;
  bankDetails?: { accountName?: string; bankName?: string; bsb?: string; accountNumber?: string } | null;
  /** INVITATION (default) or PASSWORD (Invite person, administrators only). */
  signIn: "INVITATION" | "PASSWORD";
  password?: string | null;
  /** Operations managers only: the areas ticked at Manage. Everything else is off. */
  opsPacks?: readonly string[];
  /** SMS with the invitation link. Off unless the person ticked it. */
  sendSms: boolean;
};

export type AccountCreateActor = { id: string; role: "ADMIN" | "OPS_MANAGER" };

type Tx = Prisma.TransactionClient;

export type AccountCreateOptions = {
  actor: AccountCreateActor;
  input: AccountCreateInput;
  origin: AccountCreateOrigin;
  idempotencyKey?: string | null;
  purpose?: "staff" | "client-login";
  /** Runs in the same transaction once the account exists (link an application, a client). */
  linkInTransaction?: (tx: Tx, userId: string) => Promise<void>;
  /** Extra fields kept on the CREATE_USER audit row (never secrets). */
  auditExtra?: Record<string, unknown>;
};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,80}$/;

export function normaliseIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && IDEMPOTENCY_KEY.test(value) ? value : null;
}

/** What already uses this email (any role, active or not), or null. */
export async function findAccountByEmail(email: string, client: Pick<typeof db, "user"> = db): Promise<ExistingAccountFacts | null> {
  const found = await client.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, role: true, isActive: true, client: { select: { name: true } } },
  });
  return found ? { id: found.id, email: found.email, role: found.role, isActive: found.isActive, clientName: found.client?.name ?? null } : null;
}

type PriorCreate = { userId: string; signIn: "INVITATION" | "PASSWORD" };

async function priorCreateFor(tx: Pick<Tx, "auditLog">, actorId: string, key: string): Promise<PriorCreate | null> {
  const row = await tx.auditLog.findFirst({
    where: { userId: actorId, action: "CREATE_USER", after: { path: ["idempotencyKey"], equals: key } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, after: true },
  });
  if (!row?.entityId) return null;
  const after = (row.after ?? {}) as Record<string, unknown>;
  return { userId: row.entityId, signIn: after.activationMode === "ADMIN_CREATED_ACTIVE" ? "PASSWORD" : "INVITATION" };
}

/** The first result again, read from what was stored (no new token, no new email). */
async function replayOutcome(prior: PriorCreate): Promise<AccountCreateOutcome> {
  const user = await db.user.findUnique({
    where: { id: prior.userId },
    select: { id: true, name: true, email: true, role: true, invitation: { select: { expiresAt: true } } },
  });
  if (!user) throw new AccountCreateError(409, "The earlier attempt's account no longer exists.", "CONFLICT");
  const sent = await db.auditLog.findFirst({
    where: { action: ACCOUNT_EMAIL_AUDIT_ACTION, entity: "User", entityId: user.id, after: { path: ["origin"], equals: "ACCOUNT_CREATED" } },
    orderBy: { createdAt: "desc" },
    select: { after: true },
  });
  const after = (sent?.after ?? null) as { state?: string; error?: string | null } | null;
  const state = (after?.state as InvitationEmailState | undefined) ?? (prior.signIn === "PASSWORD" ? "NOT_SENT" : "UNKNOWN");
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    replayed: true,
    signIn: prior.signIn,
    invitation: prior.signIn === "INVITATION" && user.invitation ? { expiresAt: user.invitation.expiresAt.toISOString() } : null,
    email: { state, error: after?.error ?? null },
    sms: { state: "NOT_REQUESTED", error: null },
  };
}

function isEmailUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type CreatedRow = { user: { id: string; name: string | null; email: string; phone: string | null; role: Role }; token: string | null; expiresAt: Date | null };

async function insertAccount(tx: Tx, options: AccountCreateOptions, email: string, passwordHash: string): Promise<CreatedRow> {
  const { input, actor } = options;
  const existing = await findAccountByEmail(email, tx);
  if (existing) throw new AccountCreateError(409, emailInUseMessage(existing, options.purpose ?? "staff"), "EMAIL_IN_USE", existing);
  const invite = input.signIn === "INVITATION";
  const user = await tx.user.create({
    data: {
      name: input.name.trim(),
      email,
      passwordHash,
      role: input.role,
      phone: input.phone?.trim() || undefined,
      isActive: true,
      emailVerified: invite ? null : new Date(),
      clientId: input.role === Role.CLIENT || input.role === Role.VA ? input.clientId ?? null : null,
    },
    select: { id: true, name: true, email: true, phone: true, role: true },
  });
  let token: string | null = null;
  let expiresAt: Date | null = null;
  if (invite) {
    token = generateInvitationToken();
    expiresAt = new Date(Date.now() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
    await tx.userInvitation.create({ data: { userId: user.id, token, expiresAt, createdById: actor.id } });
  }
  if (input.role === Role.OPS_MANAGER) {
    await assignNewManagerPacks(tx, { actorId: actor.id, userId: user.id, packs: input.opsPacks ?? [] });
  }
  if (options.linkInTransaction) await options.linkInTransaction(tx, user.id);
  await tx.auditLog.create({
    data: {
      userId: actor.id,
      action: "CREATE_USER",
      entity: "User",
      entityId: user.id,
      after: {
        email: user.email,
        role: user.role,
        clientId: input.clientId ?? null,
        activationMode: invite ? "ADMIN_CREATED_INVITE" : "ADMIN_CREATED_ACTIVE",
        origin: options.origin,
        actorRole: actor.role,
        // The email's answer is recorded separately (ACCOUNT_EMAIL_SENT, origin ACCOUNT_CREATED).
        emailRecordedSeparately: true,
        smsRequested: invite && input.sendSms,
        opsPacks: input.role === Role.OPS_MANAGER ? [...(input.opsPacks ?? [])] : undefined,
        idempotencyKey: options.idempotencyKey ?? null,
        ...(options.auditExtra ?? {}),
      } as Prisma.InputJsonValue,
    },
  });
  return { user, token, expiresAt };
}

async function sendInvitationSms(user: CreatedRow["user"], link: string): Promise<{ state: InvitationSmsState; error: string | null }> {
  if (!user.phone) return { state: "NO_PHONE", error: "There is no phone number on the account." };
  try {
    const body = `sNeek: you are invited to set up your account. Set your password here (valid ${INVITATION_LIFETIME_DAYS} days): ${link}`;
    const result = await sendSmsDetailed(user.phone, body, undefined, {
      typeKey: "account.invitations",
      entityKey: `User:${user.id}`,
      recipientUserId: user.id,
      messageClass: "SECURITY",
    });
    return result.ok ? { state: "ACCEPTED", error: null } : { state: "NOT_SENT", error: result.error ?? "The SMS provider did not accept it." };
  } catch (error) {
    logger.error({ err: error, userId: user.id }, "Invitation SMS failed");
    return { state: "NOT_SENT", error: "The SMS could not be sent." };
  }
}

/** Profile extras, sign-in state and cleaner learning (outside the transaction, as before). */
async function prepareAccount(options: AccountCreateOptions, created: CreatedRow): Promise<void> {
  const { input, actor } = options;
  const invite = input.signIn === "INVITATION";
  await upsertUserExtendedProfile(created.user.id, {
    businessName: input.businessName ?? null,
    abn: input.abn ?? null,
    address: input.address ?? null,
    contactNumber: input.contactNumber ?? input.phone ?? null,
    jobTitle: input.jobTitle ?? null,
    department: input.department ?? null,
    baseLocation: input.baseLocation ?? null,
    bankDetails: input.bankDetails
      ? {
          accountName: input.bankDetails.accountName ?? "",
          bankName: input.bankDetails.bankName ?? "",
          bsb: input.bankDetails.bsb ?? "",
          accountNumber: input.bankDetails.accountNumber ?? "",
        }
      : null,
  });
  await upsertAuthUserState(created.user.id, {
    requiresOnboarding: true,
    tutorialSeen: false,
    requiresPasswordReset: false,
    welcomeEmailSent: !invite,
  });
  if (created.user.role === Role.CLEANER && options.origin !== "HIRING") {
    await ensureDefaultLearningPaths(actor.id);
    await autoAssignCleanerLearning(created.user.id, actor.id);
  }
}

export async function createAccountWithInvitation(options: AccountCreateOptions): Promise<AccountCreateOutcome> {
  const { input, actor } = options;
  const email = input.email.trim().toLowerCase();
  const key = options.idempotencyKey ?? null;
  if (input.signIn === "PASSWORD" && (!input.password || input.password.length < 8)) {
    throw new AccountCreateError(400, "Password must be at least 8 characters.");
  }
  if ((input.role === Role.CLIENT || input.role === Role.VA) && !input.clientId) {
    throw new AccountCreateError(400, "A client login must be linked to a client.");
  }
  const passwordHash = await bcrypt.hash(input.signIn === "PASSWORD" ? input.password! : randomBytes(32).toString("hex"), 10);

  let created: CreatedRow | null = null;
  try {
    created = await db.$transaction(async (tx) => {
      if (key) {
        // One attempt per key at a time; a repeat after the first commit replays it.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`create-account:${actor.id}:${key}`}))`;
        const prior = await priorCreateFor(tx, actor.id, key);
        if (prior) return null;
      }
      return insertAccount(tx, options, email, passwordHash);
    });
  } catch (error) {
    if (isEmailUniqueViolation(error)) {
      const prior = key ? await priorCreateFor(db, actor.id, key) : null;
      if (prior) return replayOutcome(prior);
      const existing = await findAccountByEmail(email);
      if (existing) throw new AccountCreateError(409, emailInUseMessage(existing, options.purpose ?? "staff"), "EMAIL_IN_USE", existing);
    }
    if (error instanceof Error && error.message === "OPS_POLICY_CONFLICT") {
      throw new AccountCreateError(409, "Permissions were being changed at the same moment. Nothing was created; try again.", "CONFLICT");
    }
    throw error;
  }
  if (!created) {
    const prior = key ? await priorCreateFor(db, actor.id, key) : null;
    if (!prior) throw new AccountCreateError(409, "The earlier attempt could not be found.", "CONFLICT");
    return replayOutcome(prior);
  }

  await prepareAccount(options, created);

  const outcome: AccountCreateOutcome = {
    user: { id: created.user.id, name: created.user.name, email: created.user.email, role: created.user.role },
    replayed: false,
    signIn: input.signIn,
    invitation: created.expiresAt ? { expiresAt: created.expiresAt.toISOString() } : null,
    email: { state: "NOT_SENT", error: null },
    sms: { state: "NOT_REQUESTED", error: null },
  };
  if (!created.token || !created.expiresAt) return outcome;

  const link = buildInvitationUrl(created.token);
  const answer = await sendInvitationEmail({ to: created.user.email, name: created.user.name, role: created.user.role, url: link, expiresAt: created.expiresAt });
  const recorded = await recordAccountEmail({
    targetUserId: created.user.id,
    actorId: actor.id,
    actorRole: actor.role,
    type: "INVITATION",
    origin: "ACCOUNT_CREATED",
    to: created.user.email,
    answer,
  });
  outcome.email = { state: recorded.state === "NOT_RECORDED" ? "UNKNOWN" : recorded.state, error: recorded.error };
  if (answer.ok) await upsertAuthUserState(created.user.id, { welcomeEmailSent: true });
  if (input.sendSms) outcome.sms = await sendInvitationSms(created.user, link);
  return outcome;
}

