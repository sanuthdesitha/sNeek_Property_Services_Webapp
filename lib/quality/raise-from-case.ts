import "server-only";
/**
 * "Raise QA issue for cleaner" from a case (owner decision, fourth set item 1).
 *
 * Creates a normal QaIssue on the case's job for one of the job's assigned
 * cleaners, raised by the office user who asked. It is marked as raised from
 * the case in the model's existing `itemKey` column ("case:<caseId>"; the
 * column is only ever a form item key for review-raised issues and no reader
 * groups on it), so no schema change is needed. The case timeline gets an
 * internal note linking to the issue, and an audit row records it.
 *
 * What it does NOT do:
 * - No deduction or pay adjustment: that stays the existing "propose
 *   deduction" on the issue (a PENDING adjustment needing approval).
 * - No QA review, score or auto-score change. Like every QA issue it counts
 *   in the cleaner's quality figures (issue counts, categories and patterns;
 *   a Critical issue also breaks their quality streak) — the dialog says so.
 *
 * Idempotency: a client key replays the first answer; without one, the same
 * case, cleaner and category within DUPLICATE_WINDOW_MS return the existing
 * issue. Both checks run under an advisory lock, so a double click cannot
 * create two issues.
 */
import { QaIssueSeverity, type Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { caseIdFromItemKey, caseItemKey, issueHubHref } from "./case-origin";

export const DUPLICATE_WINDOW_MS = 2 * 60_000;
export { caseIdFromItemKey, caseItemKey, issueHubHref };

export const raiseFromCaseSchema = z.object({
  caseId: z.string().trim().min(1).max(200),
  cleanerId: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  severity: z.nativeEnum(QaIssueSeverity),
  description: z.string().trim().min(3).max(4000),
  attachmentIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  jobMediaIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/).optional(),
}).strict();

export type RaiseFromCaseInput = z.infer<typeof raiseFromCaseSchema>;

export type RaiseFromCaseResult = { issueId: string; duplicate: boolean; href: string };

export class RaiseIssueError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type Validated = {
  input: RaiseFromCaseInput;
  job: { id: string; propertyId: string };
  cleanerName: string;
  categoryLabel: string;
  photoKeys: Array<{ key: string }>;
  mediaIds: string[];
};

async function validate(input: RaiseFromCaseInput): Promise<Validated> {
  const ticket = await db.issueTicket.findUnique({ where: { id: input.caseId }, select: { id: true, jobId: true } });
  if (!ticket) throw new RaiseIssueError(404, "Case not found.");
  if (!ticket.jobId) throw new RaiseIssueError(400, "Link this case to a job first: a QA issue belongs to a job and its cleaner.");
  const job = await db.job.findUnique({
    where: { id: ticket.jobId },
    select: { id: true, propertyId: true, assignments: { where: { removedAt: null }, select: { userId: true, user: { select: { name: true, email: true } } } } },
  });
  if (!job) throw new RaiseIssueError(404, "The case's job no longer exists.");
  const assignment = job.assignments.find((row) => row.userId === input.cleanerId);
  if (!assignment) throw new RaiseIssueError(400, "That cleaner is not assigned to the case's job.");

  const settings = await getAppSettings();
  const category = settings.accountability.issueCategories.find((row) => row.key === input.category);
  if (!category) throw new RaiseIssueError(400, "Choose one of the configured QA issue categories.");

  const attachmentIds = Array.from(new Set(input.attachmentIds ?? []));
  const jobMediaIds = Array.from(new Set(input.jobMediaIds ?? []));
  const [attachments, media] = await Promise.all([
    attachmentIds.length ? db.caseAttachment.findMany({ where: { id: { in: attachmentIds }, caseId: ticket.id }, select: { id: true, s3Key: true } }) : [],
    jobMediaIds.length ? db.submissionMedia.findMany({ where: { id: { in: jobMediaIds }, mediaType: "PHOTO", submission: { jobId: job.id } }, select: { id: true, s3Key: true } }) : [],
  ]);
  if (attachments.length !== attachmentIds.length) throw new RaiseIssueError(400, "An attachment is not on this case.");
  if (media.length !== jobMediaIds.length) throw new RaiseIssueError(400, "A photo is not from this job.");

  return {
    input,
    job: { id: job.id, propertyId: job.propertyId },
    cleanerName: assignment.user.name?.trim() || assignment.user.email || "the cleaner",
    categoryLabel: category.label,
    photoKeys: [...attachments, ...media].map((row) => ({ key: row.s3Key })),
    mediaIds: media.map((row) => row.id),
  };
}

async function findDuplicate(tx: Prisma.TransactionClient, input: RaiseFromCaseInput, now: Date): Promise<string | null> {
  if (input.idempotencyKey) {
    const replay = await tx.auditLog.findFirst({
      where: { action: "QA_ISSUE_RAISED_FROM_CASE", entity: "QaIssue", after: { path: ["idempotencyKey"], equals: input.idempotencyKey } },
      select: { entityId: true },
    });
    if (replay) return replay.entityId;
  }
  const recent = await tx.qaIssue.findFirst({
    where: { itemKey: caseItemKey(input.caseId), cleanerId: input.cleanerId, category: input.category, createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return recent?.id ?? null;
}

export async function raiseQaIssueFromCase(actorId: string, raw: unknown, now: Date = new Date()): Promise<RaiseFromCaseResult> {
  const checked = await validate(raiseFromCaseSchema.parse(raw));
  const { input, job } = checked;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa-from-case:${input.caseId}:${input.cleanerId}:${input.category}`}))`;
    const duplicate = await findDuplicate(tx, input, now);
    if (duplicate) return { issueId: duplicate, duplicate: true, href: issueHubHref(duplicate) };

    const issue = await tx.qaIssue.create({
      data: {
        jobId: job.id,
        propertyId: job.propertyId,
        cleanerId: input.cleanerId,
        raisedById: actorId,
        category: input.category,
        itemKey: caseItemKey(input.caseId),
        description: input.description,
        severity: input.severity,
        ...(checked.photoKeys.length ? { qaPhotoKeys: checked.photoKeys } : {}),
        ...(checked.mediaIds.length ? { cleanerMediaIds: checked.mediaIds } : {}),
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        jobId: job.id,
        action: "QA_ISSUE_RAISED_FROM_CASE",
        entity: "QaIssue",
        entityId: issue.id,
        after: {
          caseId: input.caseId,
          cleanerId: input.cleanerId,
          category: input.category,
          severity: input.severity,
          evidenceCount: checked.photoKeys.length,
          idempotencyKey: input.idempotencyKey ?? null,
          deductionCreated: false,
        },
      },
    });
    const severity = input.severity.charAt(0) + input.severity.slice(1).toLowerCase();
    await tx.caseComment.create({
      data: {
        caseId: input.caseId,
        authorUserId: actorId,
        isInternal: true,
        body: `QA issue raised for ${checked.cleanerName}: ${checked.categoryLabel} (${severity}). It counts in the cleaner's quality figures; no deduction was made. Open it: ${issueHubHref(issue.id)}`,
      },
    });
    return { issueId: issue.id, duplicate: false, href: issueHubHref(issue.id) };
  });
}
