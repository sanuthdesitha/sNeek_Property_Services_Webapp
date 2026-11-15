import "server-only";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { AccountCreateError, createAccountWithInvitation, findAccountByEmail } from "@/lib/accounts/create-account";
import {
  accountKindLabel,
  emailInUseMessage,
  hireRefusal,
  isHireAccountKind,
  type AccountCreateOutcome,
  type HireAccountKind,
} from "@/lib/accounts/create-account-rules";
import type { ResolvedAccountCreator } from "@/lib/accounts/account-creator";
import { prepareHiredStaffAccount } from "@/lib/workforce/service";
import {
  hireDocuments,
  moveRefusal,
  parseInterviewScores,
  stageLabel,
  type InterviewScores,
} from "./pipeline";

/**
 * Hiring's server side (boards "Hiring", "Hiring application", "Hiring on a
 * phone", 2026-11-16): stage moves that never send email, interview notes
 * with optional internal scores, free-text test review, and "Mark hired and
 * invite", which creates the account through the shared invitation service
 * with an explicit account role (offer, else the role's "Hires become").
 */

export class HiringError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type OfferDetails = { roleTitle?: string; rate?: string; startDate?: string; accountRole?: string; sentAt?: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function offerOf(value: unknown): OfferDetails {
  const raw = asRecord(value);
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : undefined);
  return { roleTitle: text("roleTitle"), rate: text("rate"), startDate: text("startDate"), accountRole: text("accountRole"), sentAt: text("sentAt") };
}

/** The account role a hire gets: the offer's explicit choice, else the role's "Hires become". Never guessed. */
export function hireAccountKindFor(application: { offerDetails: unknown; position: { hireAccountRole: Role | null } | null }): HireAccountKind | null {
  const offer = offerOf(application.offerDetails).accountRole;
  if (isHireAccountKind(offer)) return offer;
  const fallback = application.position?.hireAccountRole ?? null;
  return isHireAccountKind(fallback) ? fallback : null;
}

export type HirePreview = {
  applicationId: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  accountKind: HireAccountKind | null;
  accountLabel: string | null;
  /** Why this person may not hire now (role, permissions, stage, email), or null. */
  refusal: string | null;
  /** The email is used by another account: the sentence, before anyone confirms. */
  emailInUse: string | null;
  documents: string[];
  learning: string;
  hired: { userId: string; name: string | null; role: string } | null;
};

export async function loadHirePreview(applicationId: string, creator: ResolvedAccountCreator, kindOverride?: string | null): Promise<HirePreview> {
  const application = await db.hiringApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, fullName: true, email: true, phone: true, status: true, offerDetails: true, hiredUserId: true, position: { select: { hireAccountRole: true } }, hiredUser: { select: { id: true, name: true, role: true } } },
  });
  if (!application) throw new HiringError(404, "Application not found.");
  const kind = isHireAccountKind(kindOverride) ? kindOverride : hireAccountKindFor(application);
  const existing = application.hiredUserId ? null : await findAccountByEmail(application.email);
  const emailInUse = existing ? emailInUseMessage(existing, "staff") : null;
  const stageRefusal = application.status === "HIRED" ? "Already hired." : application.status !== "OFFER" ? "Make an offer first: hiring happens from the Offer stage." : null;
  return {
    applicationId: application.id,
    name: application.fullName,
    email: application.email.toLowerCase(),
    phone: application.phone,
    status: application.status,
    accountKind: kind,
    accountLabel: kind ? accountKindLabel(kind) : null,
    refusal: hireRefusal(creator, kind) ?? emailInUse ?? stageRefusal,
    emailInUse,
    documents: kind ? hireDocuments(kind) : [],
    learning: kind ? `Mandatory learning paths for ${accountKindLabel(kind).toLowerCase()}s` : "",
    hired: application.hiredUser ? { userId: application.hiredUser.id, name: application.hiredUser.name, role: application.hiredUser.role } : null,
  };
}

export type HireResult = { outcome: AccountCreateOutcome; applicationId: string };

async function replayHire(applicationId: string): Promise<HireResult | null> {
  const row = await db.hiringApplication.findUnique({
    where: { id: applicationId },
    select: { status: true, hiredUser: { select: { id: true, name: true, email: true, role: true, invitation: { select: { expiresAt: true, acceptedAt: true } } } } },
  });
  if (!row || row.status !== "HIRED" || !row.hiredUser) return null;
  const sent = await db.auditLog.findFirst({
    where: { action: "ACCOUNT_EMAIL_SENT", entity: "User", entityId: row.hiredUser.id },
    orderBy: { createdAt: "desc" },
    select: { after: true },
  });
  const after = asRecord(sent?.after);
  return {
    applicationId,
    outcome: {
      user: { id: row.hiredUser.id, name: row.hiredUser.name, email: row.hiredUser.email, role: row.hiredUser.role },
      replayed: true,
      signIn: "INVITATION",
      invitation: row.hiredUser.invitation ? { expiresAt: row.hiredUser.invitation.expiresAt.toISOString() } : null,
      email: { state: (typeof after.state === "string" ? after.state : "UNKNOWN") as AccountCreateOutcome["email"]["state"], error: typeof after.error === "string" ? after.error : null },
      sms: { state: "NOT_REQUESTED", error: null },
    },
  };
}

/**
 * Mark hired and invite. Only from the Offer stage; the account role must be
 * explicit; operations managers only into Cleaner and Laundry accounts; never
 * while testing as someone. One transaction creates the account and moves the
 * application to Hired (a conditional update, so a double click or a second
 * office creates nothing more: the repeat returns the first result).
 */
export async function hireApplicant(input: {
  applicationId: string;
  creator: ResolvedAccountCreator;
  accountKind?: string | null;
  sendSms: boolean;
  idempotencyKey?: string | null;
  /** Operations-manager hires (administrators only): starting packs at Manage. */
  opsPacks?: readonly string[];
}): Promise<HireResult> {
  const { creator } = input;
  const application = await db.hiringApplication.findUnique({
    where: { id: input.applicationId },
    select: { id: true, fullName: true, email: true, phone: true, status: true, offerDetails: true, hiredUserId: true, position: { select: { hireAccountRole: true, title: true } } },
  });
  if (!application) throw new HiringError(404, "Application not found.");
  if (application.status === "HIRED" && application.hiredUserId) {
    const replay = await replayHire(application.id);
    if (replay) return replay;
  }
  const kind = isHireAccountKind(input.accountKind) ? input.accountKind : hireAccountKindFor(application);
  const refusal = hireRefusal(creator, kind);
  if (refusal) throw new HiringError(creator.impersonating || refusal.startsWith("Only") || refusal.startsWith("Your access") ? 403 : 400, refusal);
  if (application.status !== "OFFER") throw new HiringError(409, "Make an offer first: hiring happens from the Offer stage.");
  if (!creator.actorRole) throw new HiringError(403, "Only an administrator or an operations manager can hire.");

  const offer = offerOf(application.offerDetails);
  try {
    const outcome = await createAccountWithInvitation({
      actor: { id: creator.id, role: creator.actorRole },
      origin: "HIRING",
      idempotencyKey: input.idempotencyKey ?? null,
      purpose: "staff",
      auditExtra: { hiringApplicationId: application.id },
      input: {
        name: application.fullName,
        email: application.email,
        phone: application.phone,
        role: kind as Role,
        jobTitle: offer.roleTitle ?? application.position?.title ?? null,
        signIn: "INVITATION",
        sendSms: input.sendSms,
        opsPacks: kind === "OPS_MANAGER" ? input.opsPacks ?? [] : undefined,
      },
      linkInTransaction: async (tx, userId) => {
        const moved = await tx.hiringApplication.updateMany({
          where: { id: application.id, status: "OFFER", hiredUserId: null },
          data: {
            status: "HIRED",
            hiredUserId: userId,
            reviewedById: creator.id,
            offerDetails: { ...asRecord(application.offerDetails), accountRole: kind } as Prisma.InputJsonValue,
          },
        });
        if (moved.count !== 1) throw new HiringError(409, "The application changed while you were hiring. Reload it.");
        await tx.hiringApplicationEvent.create({
          data: {
            applicationId: application.id,
            type: "STATUS_CHANGE",
            actorId: creator.id,
            summary: `Hired: ${accountKindLabel(kind as string)} account created, invitation link issued · Offer → Hired`,
            data: { from: "OFFER", to: "HIRED", accountRole: kind, userId, smsRequested: input.sendSms },
          },
        });
      },
    });
    if (!outcome.replayed) await prepareHiredStaffAccount({ userId: outcome.user.id, role: kind as Role, actorId: creator.id });
    return { outcome, applicationId: application.id };
  } catch (error) {
    // A racing second attempt: the first one hired; return its result.
    const replay = await replayHire(application.id);
    if (replay) return replay;
    if (error instanceof AccountCreateError) throw new HiringError(error.status, error.message);
    throw error;
  }
}

/** A plain stage move. Never sends email (the page sends through the email route after its preview). */
export async function moveApplicationStage(input: {
  applicationId: string;
  actorId: string;
  to: string;
  expectedFrom?: string | null;
  offer?: OfferDetails | null;
  rejectionReason?: string | null;
}) {
  const application = await db.hiringApplication.findUnique({ where: { id: input.applicationId }, select: { id: true, status: true, offerDetails: true } });
  if (!application) throw new HiringError(404, "Application not found.");
  if (input.expectedFrom && input.expectedFrom !== application.status) {
    throw new HiringError(409, `This application is now in ${stageLabel(application.status)}. Reload the board.`);
  }
  const refusal = moveRefusal(application.status, input.to);
  if (refusal) throw new HiringError(409, refusal);
  if (input.to === "REJECTED" && !input.rejectionReason?.trim()) throw new HiringError(400, "Choose a reason for declining.");
  const data: Prisma.HiringApplicationUncheckedUpdateManyInput = { status: input.to, reviewedById: input.actorId };
  if (input.to === "OFFER" && input.offer) {
    const accountRole = isHireAccountKind(input.offer.accountRole) ? input.offer.accountRole : undefined;
    data.offerDetails = { ...asRecord(application.offerDetails), ...input.offer, accountRole } as Prisma.InputJsonValue;
  }
  if (input.to === "REJECTED") data.rejectionReason = input.rejectionReason!.trim().slice(0, 500);
  return db.$transaction(async (tx) => {
    const moved = await tx.hiringApplication.updateMany({ where: { id: application.id, status: application.status }, data });
    if (moved.count !== 1) throw new HiringError(409, "The application changed at the same moment. Reload the board.");
    await tx.hiringApplicationEvent.create({
      data: {
        applicationId: application.id,
        type: "STATUS_CHANGE",
        actorId: input.actorId,
        summary: `${stageLabel(application.status)} → ${stageLabel(input.to)}`,
        data: { from: application.status, to: input.to, emailSentByMove: false },
      },
    });
    return { id: application.id, from: application.status, to: input.to };
  });
}

/** Record that the offer email went out (the card's "No reply" clock starts here). */
export async function markOfferSent(applicationId: string) {
  const row = await db.hiringApplication.findUnique({ where: { id: applicationId }, select: { offerDetails: true } });
  if (!row) return;
  await db.hiringApplication.update({ where: { id: applicationId }, data: { offerDetails: { ...asRecord(row.offerDetails), sentAt: new Date().toISOString() } as Prisma.InputJsonValue } });
}

/** Interview date, notes and the optional internal scores (never shown to the candidate). */
export async function saveInterview(input: { applicationId: string; actorId: string; interviewDate: string | null; interviewNotes: string | null; scores: InterviewScores }) {
  const row = await db.hiringApplication.findUnique({ where: { id: input.applicationId }, select: { evaluation: true } });
  if (!row) throw new HiringError(404, "Application not found.");
  const when = input.interviewDate ? new Date(input.interviewDate) : null;
  if (when && Number.isNaN(when.getTime())) throw new HiringError(400, "Enter a valid interview date and time.");
  const evaluation = asRecord(row.evaluation);
  evaluation.interviewScores = parseInterviewScores(input.scores);
  await db.$transaction([
    db.hiringApplication.update({
      where: { id: input.applicationId },
      data: { interviewDate: when, interviewNotes: input.interviewNotes?.trim().slice(0, 8000) || null, evaluation: evaluation as Prisma.InputJsonValue },
    }),
    db.hiringApplicationEvent.create({ data: { applicationId: input.applicationId, type: "NOTE", actorId: input.actorId, summary: "Interview notes saved" } }),
  ]);
}

/** A reviewer's call on one free-text test answer. Kept beside the score; the stored score is not changed. */
export async function markFreeTextAnswer(input: { applicationId: string; actorId: string; answerId: string; verdict: "right" | "wrong" }) {
  const row = await db.hiringApplication.findUnique({ where: { id: input.applicationId }, select: { evaluation: true } });
  if (!row) throw new HiringError(404, "Application not found.");
  const evaluation = asRecord(row.evaluation);
  const review = asRecord(evaluation.freeTextReview);
  review[input.answerId.slice(0, 120)] = { verdict: input.verdict, by: input.actorId, at: new Date().toISOString() };
  evaluation.freeTextReview = review;
  await db.hiringApplication.update({ where: { id: input.applicationId }, data: { evaluation: evaluation as Prisma.InputJsonValue } });
}
