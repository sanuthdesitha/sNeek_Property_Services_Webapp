import "server-only";
/**
 * Log a client complaint or an issue the office noticed, by hand, from the
 * All issues register (pilot "All issues register", 2026-11-28).
 *
 * No new model: the existing case (IssueTicket) fits — property, optional job,
 * severity, description, attachments — and the register reads cases anyway.
 * A client complaint is a CLIENT_DISPUTE case, an office-noticed issue an OPS
 * case; both carry source "ISSUES_REGISTER" and the register's own fields
 * (category, cleaner, date received, who raised it) under `metadata.register`.
 * Cases logged here are never visible to the client and send no message: the
 * person logging it is the office. Audited with the actual actor; a retry
 * with the same request key returns the same case.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { createCase } from "@/lib/cases/service";
import { validateCaseLinks } from "@/lib/cases/link-validation";
import { isOwnUploadKey } from "@/lib/uploads/ownership";
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";
import { REGISTER_SEVERITIES } from "./model";

export const REGISTER_CASE_SOURCE = "ISSUES_REGISTER";
export const REGISTER_LOG_KINDS = ["CLIENT_COMPLAINT", "OFFICE"] as const;
export type RegisterLogKind = (typeof REGISTER_LOG_KINDS)[number];
const CASE_TYPE_FOR_KIND: Record<RegisterLogKind, string> = { CLIENT_COMPLAINT: "CLIENT_DISPUTE", OFFICE: "OPS" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const registerLogInput = z.object({
  requestKey: z.string().trim().regex(/^[A-Za-z0-9:_-]{8,80}$/),
  kind: z.enum(REGISTER_LOG_KINDS),
  propertyId: z.string().trim().min(1).max(64),
  jobNumber: z.string().trim().max(64).optional().nullable(),
  cleanerId: z.string().trim().max(64).optional().nullable(),
  category: z.string().trim().min(1).max(64),
  severity: z.enum(REGISTER_SEVERITIES),
  description: z.string().trim().min(3).max(4000),
  receivedOn: z.string().trim().regex(DAY),
  raisedBy: z.string().trim().min(1).max(120),
  photos: z
    .array(z.object({ s3Key: z.string().trim().min(1).max(512), mimeType: z.string().trim().max(120).optional().nullable(), label: z.string().trim().max(200).optional().nullable() }))
    .max(10)
    .default([]),
});
export type RegisterLogInput = z.infer<typeof registerLogInput>;

export class RegisterLogError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type RegisterLogActor = { id: string; role: string };
export type RegisterLogResult = { caseId: string; duplicate: boolean };

async function findByRequestKey(requestKey: string): Promise<string | null> {
  const existing = await db.issueTicket.findFirst({
    where: { source: REGISTER_CASE_SOURCE, metadata: { path: ["register", "requestKey"], equals: requestKey } },
    select: { id: true },
  });
  return existing?.id ?? null;
}

export async function logRegisterIssue(actor: RegisterLogActor, raw: unknown, now = new Date()): Promise<RegisterLogResult> {
  const input = registerLogInput.parse(raw);
  const replay = await findByRequestKey(input.requestKey);
  if (replay) return { caseId: replay, duplicate: true };

  const receivedDay = input.receivedOn;
  // One day of slack for time zones; a later date is a typing mistake.
  if (receivedDay > addDaysToKey(sydneyTodayKey(now), 1)) throw new RegisterLogError(400, "The date received is in the future.");
  for (const photo of input.photos) {
    if (!photo.s3Key.startsWith("cases/") || !isOwnUploadKey(photo.s3Key, actor.id)) {
      throw new RegisterLogError(400, "Attach only photos you uploaded here.");
    }
  }

  let jobId: string | null = null;
  if (input.jobNumber) {
    const job = await db.job.findUnique({ where: { jobNumber: input.jobNumber }, select: { id: true, propertyId: true } });
    if (!job) throw new RegisterLogError(400, "No job has that number.");
    if (job.propertyId !== input.propertyId) throw new RegisterLogError(400, "That job is at a different property.");
    jobId = job.id;
  }
  if (input.cleanerId) {
    const cleaner = await db.user.findFirst({ where: { id: input.cleanerId, ...holdsRoleWhere("CLEANER") }, select: { id: true } });
    if (!cleaner) throw new RegisterLogError(400, "Choose a cleaner from the list.");
  }
  const links = await validateCaseLinks({ jobId, propertyId: input.propertyId });
  const property = await db.property.findUnique({ where: { id: input.propertyId }, select: { clientId: true } });

  const afterCommit: Array<() => Promise<unknown>> = [];
  const created = await db.$transaction(async (tx) => {
    // Two taps of Save with one request key make one case.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`issues-register:${input.requestKey}`}))`;
    const raced = await tx.issueTicket.findFirst({
      where: { source: REGISTER_CASE_SOURCE, metadata: { path: ["register", "requestKey"], equals: input.requestKey } },
      select: { id: true },
    });
    if (raced) return { id: raced.id, duplicate: true };
    const issue = await createCase(
      {
        title: input.description.split("\n")[0].slice(0, 120),
        description: input.description,
        severity: input.severity,
        status: "OPEN",
        caseType: CASE_TYPE_FOR_KIND[input.kind],
        source: REGISTER_CASE_SOURCE,
        jobId: links.jobId,
        propertyId: links.propertyId,
        clientId: property?.clientId ?? null,
        clientVisible: false,
        clientCanReply: false,
        metadata: {
          register: {
            requestKey: input.requestKey,
            kind: input.kind,
            category: input.category,
            cleanerId: input.cleanerId || null,
            receivedOn: receivedDay,
            raisedBy: input.raisedBy,
            loggedById: actor.id,
            loggedByRole: actor.role,
          },
        },
        attachments: input.photos.map((photo) => ({
          uploadedByUserId: actor.id,
          s3Key: photo.s3Key,
          mimeType: photo.mimeType ?? null,
          label: photo.label ?? null,
        })),
      },
      { transaction: tx, afterCommit },
    );
    if (!issue) throw new RegisterLogError(500, "The issue could not be saved.");
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        jobId: links.jobId,
        action: "ISSUE_REGISTER_LOGGED",
        entity: "IssueTicket",
        entityId: issue.id,
        after: { kind: input.kind, category: input.category, severity: input.severity, propertyId: links.propertyId, cleanerId: input.cleanerId || null, receivedOn: receivedDay, raisedBy: input.raisedBy, photos: input.photos.length, actorRole: actor.role } as Prisma.InputJsonValue,
      },
    });
    return { id: issue.id, duplicate: false };
  });
  for (const task of afterCommit) await task().catch((error) => console.error("[issues-register] after-commit step failed", error));
  return { caseId: created.id, duplicate: created.duplicate };
}
