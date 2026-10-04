import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { getAuthoritativeQaReview } from "@/lib/qa/authority";
import { addCalendarMonths } from "./cadence-ledger";

export const DEEP_CLEAN_PLAN_PREFIX = "property_deep_clean_plan_v1:";
const TZ = "Australia/Sydney";
const baselineSchema = z.object({
  jobId: z.string(), completedAt: z.string().datetime(), completedDay: z.string().date(), dueDay: z.string().date(),
  verifiedBy: z.string(), verifiedAt: z.string().datetime(), reviewNote: z.string(),
  submissionId: z.string(), proofKeys: z.array(z.string()).min(1), qaReviewId: z.string().nullable(),
});
const proposalSchema = z.object({
  id: z.string(), baselineJobId: z.string(), dueDay: z.string().date(), createdAt: z.string().datetime(),
  status: z.enum(["NEEDS_SCHEDULING", "DEFERRED", "SCHEDULED", "SUPERSEDED"]),
  jobId: z.string().nullable(), scheduledDay: z.string().date().nullable(), scheduledBy: z.string().nullable(),
});
const planSchema = z.object({
  version: z.literal(1), propertyId: z.string(), revision: z.number().int().nonnegative(),
  baseline: baselineSchema.nullable(), proposal: proposalSchema.nullable(), history: z.array(proposalSchema),
});
export type DeepCleanPlan = z.infer<typeof planSchema>;
export class DeepCleanPlanningError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new DeepCleanPlanningError(status, code, message); };
const keyFor = (id: string) => `${DEEP_CLEAN_PLAN_PREFIX}${id}`;
function empty(propertyId: string): DeepCleanPlan { return { version: 1, propertyId, revision: 0, baseline: null, proposal: null, history: [] }; }
function decode(value: unknown, propertyId: string): DeepCleanPlan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success || parsed.data.propertyId !== propertyId) return fail(409, "STORAGE_INVALID", "Deep-clean planning data needs office review.");
  return parsed.data;
}
async function read(tx: Pick<Prisma.TransactionClient, "appSetting">, propertyId: string) {
  const row = await tx.appSetting.findUnique({ where: { key: keyFor(propertyId) }, select: { value: true } });
  return row ? decode(row.value, propertyId) : empty(propertyId);
}
async function lock(tx: Prisma.TransactionClient, propertyId: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${keyFor(propertyId)}, 0))`;
  const property = await tx.property.findUnique({ where: { id: propertyId }, select: { id: true, isActive: true } });
  if (!property?.isActive) fail(404, "PROPERTY_NOT_FOUND", "Active property not found.");
}
async function persist(tx: Prisma.TransactionClient, plan: DeepCleanPlan, action: string, actorId?: string) {
  const value = planSchema.parse(plan) as Prisma.InputJsonObject;
  const userId = actorId ?? plan.baseline?.verifiedBy;
  if (!userId) return fail(409, "AUDIT_ACTOR_REQUIRED", "Re-verify the baseline before generating a proposal.");
  // The verifier authorized this baseline; the audit must distinguish scheduler execution
  // from a new action personally performed by that administrator. The FK remains enforced.
  const after: Prisma.InputJsonObject = actorId ? value : { ...value, automation: { actor: "deep-clean-planning-scheduler", authorizedBy: userId, authorization: "verified-deep-clean-baseline" } };
  await tx.appSetting.upsert({ where: { key: keyFor(plan.propertyId) }, create: { key: keyFor(plan.propertyId), value }, update: { value } });
  await tx.auditLog.create({ data: { userId, action, entity: "Property", entityId: plan.propertyId, after } });
}
function assertRevision(plan: DeepCleanPlan, revision: number) {
  if (plan.revision !== revision) fail(409, "REVISION_CONFLICT", "Deep-clean planning changed. Reload before saving.");
}
const evidenceSelect = {
  id: true, propertyId: true, jobNumber: true, jobType: true, status: true, completedAt: true, internalNotes: true, isRework: true,
  formSubmissions: { orderBy: { createdAt: "desc" as const }, take: 1, select: { id: true, media: { where: { mediaType: { in: ["PHOTO" as const, "VIDEO" as const] } }, select: { s3Key: true } } } },
} satisfies Prisma.JobSelect;
async function evidence(tx: Pick<Prisma.TransactionClient, "job" | "qAReview">, propertyId: string, jobId: string, now: Date) {
  const job = await tx.job.findUnique({ where: { id: jobId }, select: evidenceSelect });
  if (!job || job.propertyId !== propertyId || job.jobType !== "DEEP_CLEAN" || job.isRework || parseJobInternalNotes(job.internalNotes).isDraft || !["COMPLETED", "INVOICED"].includes(job.status) || !job.completedAt || job.completedAt > now) {
    return fail(409, "BASELINE_INVALID", "Select a completed deep-clean job for this property, with a valid completion date.");
  }
  const submission = job.formSubmissions[0];
  const proofKeys = submission?.media.map(media => media.s3Key).filter((key): key is string => Boolean(key?.trim())) ?? [];
  if (!submission || !proofKeys.length) fail(409, "PROOF_REQUIRED", "Submitted photo or video evidence is required. Review it before verifying the baseline.");
  const qa = await getAuthoritativeQaReview(job.id, tx);
  if (qa && !qa.passed) fail(409, "QA_FAILED", "The authoritative QA review has not passed. Resolve it before verifying a deep clean.");
  return { job, submission, proofKeys, qa };
}
async function baselineIsCurrent(tx: Pick<Prisma.TransactionClient, "job" | "qAReview">, plan: DeepCleanPlan, now: Date) {
  if (!plan.baseline) return false;
  try {
    const current = await evidence(tx, plan.propertyId, plan.baseline.jobId, now);
    return current.job.completedAt!.toISOString() === plan.baseline.completedAt && current.submission.id === plan.baseline.submissionId
      && (current.qa?.id ?? null) === plan.baseline.qaReviewId && plan.baseline.proofKeys.every(key => current.proofKeys.includes(key));
  } catch (error) { if (error instanceof DeepCleanPlanningError) return false; throw error; }
}
function createDueProposal(plan: DeepCleanPlan, now: Date): boolean {
  if (!plan.baseline || plan.baseline.dueDay > formatInTimeZone(now, TZ, "yyyy-MM-dd")) return false;
  // A scheduled proposal is a durable receipt for this baseline, not a reason to propose again.
  if (plan.proposal?.baselineJobId === plan.baseline.jobId && plan.proposal.status === "DEFERRED") { plan.proposal.status = "NEEDS_SCHEDULING"; return true; }
  if (plan.proposal?.baselineJobId === plan.baseline.jobId || plan.history.some(p => p.baselineJobId === plan.baseline!.jobId)) return false;
  plan.proposal = { id: `${plan.propertyId}:${plan.baseline.jobId}`, baselineJobId: plan.baseline.jobId, dueDay: plan.baseline.dueDay, createdAt: now.toISOString(), status: "NEEDS_SCHEDULING", jobId: null, scheduledDay: null, scheduledBy: null };
  return true;
}

/** Read only; candidate evidence is never promoted into a verified baseline. */
export async function readDeepCleanPlan(propertyId: string, now = new Date()) {
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true, isActive: true } });
  if (!property?.isActive) return fail(404, "PROPERTY_NOT_FOUND", "Active property not found.");
  const [plan, candidates] = await Promise.all([
    read(db, propertyId),
    db.job.findMany({ where: { propertyId, jobType: "DEEP_CLEAN", isRework: false, status: { in: ["COMPLETED", "INVOICED"] }, completedAt: { lte: now } }, orderBy: { completedAt: "desc" }, take: 50, select: evidenceSelect }),
  ]);
  const baselineValid = await baselineIsCurrent(db, plan, now);
  return { property, plan, baselineValid, today: formatInTimeZone(now, TZ, "yyyy-MM-dd"), candidates: candidates.filter(job => !parseJobInternalNotes(job.internalNotes).isDraft).map(job => ({ id: job.id, jobNumber: job.jobNumber, completedAt: job.completedAt, hasProof: job.formSubmissions.some(s => s.media.some(m => Boolean(m.s3Key?.trim()))) })) };
}
const verifySchema = z.object({ propertyId: z.string().min(1), jobId: z.string().min(1), revision: z.number().int().nonnegative(), reviewNote: z.string().trim().min(1).max(2000), evidenceReviewed: z.literal(true) });
export async function verifyDeepCleanBaseline(input: z.infer<typeof verifySchema>, actorId: string, now = new Date()) {
  const body = verifySchema.parse(input);
  return db.$transaction(async tx => {
    await lock(tx, body.propertyId);
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${body.jobId} FOR UPDATE`;
    const plan = await read(tx, body.propertyId); assertRevision(plan, body.revision);
    const reviewed = await evidence(tx, body.propertyId, body.jobId, now);
    const completedAt = reviewed.job.completedAt!.toISOString();
    if (plan.baseline && completedAt < plan.baseline.completedAt) fail(409, "OLDER_BASELINE", "A later verified completion already exists. Review the current baseline first.");
    if (plan.proposal && plan.proposal.baselineJobId !== body.jobId) {
      plan.history.push({ ...plan.proposal, status: ["NEEDS_SCHEDULING", "DEFERRED"].includes(plan.proposal.status) ? "SUPERSEDED" : plan.proposal.status }); plan.proposal = null;
    }
    const completedDay = formatInTimeZone(reviewed.job.completedAt!, TZ, "yyyy-MM-dd");
    plan.baseline = { jobId: body.jobId, completedAt, completedDay, dueDay: addCalendarMonths(completedDay, 3), verifiedBy: actorId, verifiedAt: now.toISOString(), reviewNote: body.reviewNote, submissionId: reviewed.submission.id, proofKeys: reviewed.proofKeys, qaReviewId: reviewed.qa?.id ?? null };
    if (plan.proposal?.baselineJobId === body.jobId && ["NEEDS_SCHEDULING", "DEFERRED"].includes(plan.proposal.status)) {
      plan.proposal.dueDay = plan.baseline.dueDay;
      plan.proposal.status = plan.baseline.dueDay > formatInTimeZone(now, TZ, "yyyy-MM-dd") ? "DEFERRED" : "NEEDS_SCHEDULING";
    }
    createDueProposal(plan, now); plan.revision += 1;
    await persist(tx, plan, "DEEP_CLEAN_BASELINE_VERIFIED", actorId); return plan;
  });
}

/** No jobs, assignment, charges or external delivery; safe for an explicitly wired scheduler. */
export async function planDueDeepCleanDrafts(input: { now?: Date; limit?: number; cursor?: string } = {}) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)));
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: DEEP_CLEAN_PLAN_PREFIX, ...(input.cursor ? { gt: input.cursor } : {}) } }, orderBy: { key: "asc" }, take: limit, select: { key: true } });
  const result = { scanned: rows.length, created: 0, existing: 0, invalid: 0, errors: 0, nextCursor: rows.length === limit ? rows[rows.length - 1].key : null };
  for (const row of rows) {
    try {
      const outcome = await db.$transaction(async tx => {
        const propertyId = row.key.slice(DEEP_CLEAN_PLAN_PREFIX.length); await lock(tx, propertyId);
        const plan = await read(tx, propertyId);
        if (plan.baseline) await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${plan.baseline.jobId} FOR UPDATE`;
        if (!await baselineIsCurrent(tx, plan, now)) return "invalid" as const;
        if (!createDueProposal(plan, now)) return "existing" as const;
        plan.revision += 1; await persist(tx, plan, "DEEP_CLEAN_PROPOSAL_CREATED"); return "created" as const;
      }); result[outcome] += 1;
    } catch (error) { if (error instanceof DeepCleanPlanningError) result.invalid += 1; else result.errors += 1; }
  }
  return result;
}
const scheduleSchema = z.object({ propertyId: z.string().min(1), proposalId: z.string().min(1), revision: z.number().int().nonnegative(), date: z.string().date() });
export async function scheduleDeepCleanProposal(input: z.infer<typeof scheduleSchema>, actorId: string, now = new Date()) {
  const body = scheduleSchema.parse(input);
  return db.$transaction(async tx => {
    await lock(tx, body.propertyId);
    const plan = await read(tx, body.propertyId);
    const proposal = plan.proposal;
    if (!proposal || proposal.id !== body.proposalId) return fail(404, "PROPOSAL_NOT_FOUND", "This proposal is no longer current. Reload planning.");
    // An identical retry returns the already-created draft; a different date must use job editing.
    if (proposal.status === "SCHEDULED" && proposal.scheduledDay === body.date) return { plan, jobId: proposal.jobId };
    assertRevision(plan, body.revision);
    if (proposal.dueDay > formatInTimeZone(now, TZ, "yyyy-MM-dd")) fail(409, "NOT_DUE", "This proposal is deferred until the next deep-clean due date.");
    if (proposal.status !== "NEEDS_SCHEDULING") fail(409, "ALREADY_SCHEDULED", "This proposal already has a job. Open it to change the date.");
    if (body.date < formatInTimeZone(now, TZ, "yyyy-MM-dd")) fail(400, "PAST_DATE", "Choose today or a future date.");
    if (plan.baseline) await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${plan.baseline.jobId} FOR UPDATE`;
    if (!await baselineIsCurrent(tx, plan, now)) fail(409, "BASELINE_CHANGED", "Completion evidence changed. Re-verify the baseline before scheduling.");
    const job = await tx.job.create({ data: {
      propertyId: body.propertyId, jobNumber: await reserveJobNumber(tx), jobType: "DEEP_CLEAN", status: "UNASSIGNED",
      scheduledDate: fromZonedTime(`${body.date}T00:00:00`, TZ),
      internalNotes: serializeJobInternalNotes({ isDraft: true, tags: ["deep-clean-review"], internalNoteText: `Owner scheduled deep-clean proposal ${proposal.id}. Review scope and pricing before publishing.` }),
    }, select: { id: true } });
    plan.proposal = { ...proposal, status: "SCHEDULED", jobId: job.id, scheduledDay: body.date, scheduledBy: actorId }; plan.revision += 1;
    await persist(tx, plan, "DEEP_CLEAN_PROPOSAL_SCHEDULED", actorId);
    return { plan, jobId: job.id };
  });
}
export async function listDeepCleanProposals(cursor?: string, now = new Date()) {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: DEEP_CLEAN_PLAN_PREFIX, ...(cursor ? { gt: cursor } : {}) } }, orderBy: { key: "asc" }, take: 100, select: { key: true, value: true } });
  const plans = rows.map(row => decode(row.value, row.key.slice(DEEP_CLEAN_PLAN_PREFIX.length)));
  const properties = await db.property.findMany({ where: { id: { in: plans.map(p => p.propertyId) }, isActive: true }, select: { id: true, name: true } });
  const names = new Map(properties.map(p => [p.id, p.name]));
  const proposals = await Promise.all(plans.filter(plan => plan.proposal?.status === "NEEDS_SCHEDULING" && names.has(plan.propertyId)).map(async plan => ({ propertyId: plan.propertyId, propertyName: names.get(plan.propertyId)!, revision: plan.revision, proposal: plan.proposal!, baselineValid: await baselineIsCurrent(db, plan, now) })));
  return { proposals, nextCursor: rows.length === 100 ? rows[rows.length - 1].key : null };
}
