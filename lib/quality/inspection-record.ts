/**
 * Reads the office view of one submitted QA inspection (board
 * "QualityInspection") for /v2/admin/quality/[assignmentId]. Read-only: every
 * change on that page goes through the existing endpoints (reopen, AI photo
 * review decision, QA issue actions).
 *
 * Scope: ADMIN and OPS_MANAGER read any inspection; a QA inspector reads only
 * an inspection assigned to them or picked up by them (isQaAssignmentOwner).
 * Anyone else, or an inspection outside that scope, reads as "not found".
 */
import { QaAssignmentStatus, Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isQaAssignmentOwner } from "@/lib/qa/ownership";
import { canReopenInspection, reopenMoneyWarnings } from "@/lib/qa/reopen";
import { collectReopenMoneyFacts } from "@/lib/qa/reopen-facts";
import { normalizeVerdictScale, verdictOptionsForScale } from "@/lib/qa/verdict-scale";
import { QA_TOOLS_DATA_KEY } from "@/lib/qa/inspection-tools";
import { jobTypeLabel } from "@/lib/qa/templates";
import { pickAuthoritativeReview } from "./authority";
import {
  buildRecordAreas,
  buildScoreLines,
  buildWhoFixes,
  issueVerdictKey,
  qaIssueVerdictLabel,
  ratingPresentation,
  type IssueForArea,
} from "./inspection-record-build";
import type {
  InspectionRecord,
  RecordDamage,
  RecordEvidence,
  RecordNextClean,
  RecordSignOff,
} from "./inspection-record-types";

export type RecordViewer = { id: string; role: Role | string };

const VIEWER_ROLES = new Set<string>([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
const EVIDENCE_PREVIEW_COUNT = 5;

/** Whether this viewer may read this inspection at all. */
export function mayReadInspection(viewer: RecordViewer, assignment: { assignedToId: string | null; pickedUpById: string | null }): boolean {
  const role = String(viewer.role);
  if (!VIEWER_ROLES.has(role)) return false;
  if (role === Role.QA_INSPECTOR) return isQaAssignmentOwner(assignment, viewer.id);
  return true;
}

/** Status of the assignment, for the page to choose the record or the workspace. */
export async function loadInspectionStatus(assignmentId: string): Promise<{ jobId: string; status: QaAssignmentStatus; hasSubmission: boolean } | null> {
  const assignment = await db.qaAssignment.findUnique({
    where: { id: assignmentId },
    select: { jobId: true, status: true, submissions: { select: { id: true }, take: 1 } },
  });
  if (!assignment) return null;
  return { jobId: assignment.jobId, status: assignment.status, hasSubmission: assignment.submissions.length > 0 };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function qaPhotoList(raw: unknown): Array<{ key: string; markedUp: boolean }> {
  if (!Array.isArray(raw)) return [];
  const photos: Array<{ key: string; markedUp: boolean }> = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry) photos.push({ key: entry, markedUp: false });
    const record = asRecord(entry);
    if (!record) continue;
    if (typeof record.flatKey === "string") photos.push({ key: record.flatKey, markedUp: true });
    else if (typeof record.key === "string") photos.push({ key: record.key, markedUp: typeof record.annotatedKey === "string" });
  }
  return photos;
}

function readDamage(tools: Record<string, unknown> | null): RecordDamage[] {
  const raw = tools?.damage;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, index) => {
    const item = asRecord(entry);
    if (!item) return [];
    const annotations = asRecord(item.annotations) ?? {};
    // Prefer the flattened mark-up of a photo when one was made.
    const photoKeys = stringList(item.photoKeys).map((key) => {
      const flat = asRecord(annotations[key])?.flatKey;
      return typeof flat === "string" && flat ? flat : key;
    });
    return [
      {
        id: typeof item.id === "string" ? item.id : `damage-${index}`,
        area: typeof item.area === "string" ? item.area : "",
        description: typeof item.description === "string" ? item.description : "",
        severity: typeof item.severity === "string" ? item.severity : "",
        photoKeys,
        estimatedCost: typeof item.estimatedCost === "number" && Number.isFinite(item.estimatedCost) ? item.estimatedCost : null,
      },
    ];
  });
}

function readNextClean(tools: Record<string, unknown> | null): RecordNextClean[] {
  const raw = tools?.nextClean;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, index) => {
    const item = asRecord(entry);
    if (!item || typeof item.note !== "string") return [];
    return [
      {
        id: typeof item.id === "string" ? item.id : `next-${index}`,
        kind: item.kind === "DEEP_CLEAN_AREA" ? "DEEP_CLEAN_AREA" : "SPECIAL_REQUEST",
        area: typeof item.area === "string" && item.area ? item.area : null,
        note: item.note,
      },
    ];
  });
}

function readSignOff(tools: Record<string, unknown> | null): RecordSignOff | null {
  const signOff = asRecord(tools?.signOff);
  if (!signOff) return null;
  return {
    signedByName: typeof signOff.signedByName === "string" ? signOff.signedByName : null,
    signedAt: typeof signOff.signedAt === "string" ? signOff.signedAt : null,
    attested: signOff.attested === true,
    signatureKey: typeof signOff.signatureKey === "string" ? signOff.signatureKey : null,
  };
}

/** Field labels of the cleaner's form, for naming the evidence photos. */
function cleanerFieldLabels(data: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  const sections = asRecord(asRecord(data)?.__templateSchema)?.sections;
  if (!Array.isArray(sections)) return labels;
  for (const section of sections) {
    const fields = asRecord(section)?.fields;
    if (!Array.isArray(fields)) continue;
    for (const raw of fields) {
      const field = asRecord(raw);
      if (field && typeof field.id === "string" && typeof field.label === "string") labels.set(field.id, field.label);
    }
  }
  return labels;
}

function dayKey(value: Date | null, timeZone: string): string | null {
  return value ? formatInTimeZone(value, timeZone, "yyyy-MM-dd") : null;
}

/**
 * The record, or null when the inspection does not exist, is outside the
 * viewer's scope, or has no submitted inspection form yet.
 */
export async function loadInspectionRecord(assignmentId: string, viewer: RecordViewer): Promise<InspectionRecord | null> {
  const assignment = await db.qaAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      assignedTo: { select: { name: true, email: true } },
      pickedUpBy: { select: { name: true, email: true } },
      job: {
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          status: true,
          scheduledDate: true,
          property: { select: { name: true } },
          assignments: { where: { removedAt: null }, select: { user: { select: { id: true, name: true, email: true } } } },
        },
      },
    },
  });
  if (!assignment || !mayReadInspection(viewer, assignment)) return null;

  const submission =
    (await db.qaFormSubmission.findFirst({
      where: { assignmentId: assignment.id },
      orderBy: { createdAt: "desc" },
      include: { template: { select: { name: true, version: true, schema: true } }, submittedBy: { select: { name: true, email: true } } },
    })) ?? null;
  if (!submission) return null;

  const settings = await getAppSettings();
  const timeZone = settings.timezone || "Australia/Sydney";
  const categoryLabels = new Map(settings.accountability.issueCategories.map((category) => [category.key, category.label]));
  const job = assignment.job;

  const [review, jobReviews, issues, cleanerSubmission, reworkJobs, transfers, deduction] = await Promise.all([
    submission.qaReviewId ? db.qAReview.findUnique({ where: { id: submission.qaReviewId } }) : Promise.resolve(null),
    db.qAReview.findMany({ where: { jobId: job.id }, select: { id: true, kind: true, createdAt: true } }),
    db.qaIssue.findMany({
      where: submission.qaReviewId ? { qaReviewId: submission.qaReviewId } : { qaSubmissionId: submission.id },
      orderBy: { createdAt: "asc" },
    }),
    db.formSubmission.findFirst({
      where: { jobId: job.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        data: true,
        createdAt: true,
        submittedBy: { select: { name: true, email: true } },
        media: { where: { mediaType: "PHOTO" }, select: { id: true, fieldId: true, s3Key: true, label: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    db.job.findMany({
      where: { reworkOfJobId: job.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        createdAt: true,
        completedAt: true,
        reworkPayAmount: true,
        reworkDeductFromCleanerId: true,
        assignments: { where: { removedAt: null }, select: { user: { select: { name: true, email: true } } } },
      },
    }),
    db.qaReworkTransfer.findMany({
      where: { jobId: job.id },
      orderBy: { createdAt: "asc" },
      include: { qaUser: { select: { name: true } }, cleaner: { select: { name: true, email: true } } },
    }),
    db.cleanerPayAdjustment.findFirst({
      where: { source: "REWORK_DEDUCTION", sourceKey: `rework:${job.id}` },
      select: { status: true, requestedAmount: true },
    }),
  ]);

  const nameOf = (person: { name: string | null; email?: string | null } | null | undefined) => person?.name ?? person?.email ?? null;
  const cleanerNames = job.assignments.map((entry) => nameOf(entry.user)).filter((name): name is string => Boolean(name));
  const deductFromIds = Array.from(new Set(reworkJobs.map((rework) => rework.reworkDeductFromCleanerId).filter((id): id is string => Boolean(id))));
  const deductFromUsers = deductFromIds.length ? await db.user.findMany({ where: { id: { in: deductFromIds } }, select: { id: true, name: true, email: true } }) : [];
  const deductFromName = new Map(deductFromUsers.map((user) => [user.id, nameOf(user)]));

  const verdictScale = normalizeVerdictScale(assignment.verdictScale);
  const areaIssues: IssueForArea[] = issues.map((issue) => ({
    id: issue.id,
    fieldId: issue.fieldId,
    categoryLabel: categoryLabels.get(issue.category) ?? issue.category,
    description: issue.description,
    verdictLabel: qaIssueVerdictLabel(issue),
    verdictKey: issueVerdictKey(issue),
    severity: issue.severity,
    falseConfirmation: issue.falseConfirmation,
    rectificationStatus: issue.rectificationStatus,
    cleanerMarkedComplete: issue.cleanerMarkedComplete,
    guestReadyImpact: issue.guestReadyImpact,
    qaPhotos: qaPhotoList(issue.qaPhotoKeys),
  }));
  const schema = submission.templateSnapshot ?? submission.template?.schema ?? null;
  const areas = buildRecordAreas(schema, areaIssues);

  const tools = asRecord(asRecord(submission.data)?.[QA_TOOLS_DATA_KEY]);
  const scoreReview = pickAuthoritativeReview(jobReviews);

  // The approval route's own refusals, as facts the AI panel can explain.
  const [coveringIssues, deductedAnalyses] = scoreReview
    ? await Promise.all([
        db.qaIssue.findMany({ where: { qaReviewId: scoreReview.id }, select: { fieldId: true, cleanerMediaIds: true } }),
        db.aiPhotoReview.findMany({
          where: { reviewedAt: { not: null }, submission: { jobId: job.id }, decision: { path: ["qaReviewId"], equals: scoreReview.id } },
          select: { id: true },
        }),
      ])
    : [[], []];

  let evidence: RecordEvidence | null = null;
  if (cleanerSubmission) {
    const labels = cleanerFieldLabels(cleanerSubmission.data);
    evidence = {
      submittedByName: nameOf(cleanerSubmission.submittedBy),
      submittedAt: cleanerSubmission.createdAt.toISOString(),
      photoCount: cleanerSubmission.media.length,
      photos: cleanerSubmission.media.slice(0, EVIDENCE_PREVIEW_COUNT).map((media) => ({
        id: media.id,
        key: media.s3Key,
        label: media.label || labels.get(media.fieldId) || "Photo",
      })),
    };
  }

  const eligibility = canReopenInspection({
    actorUserId: viewer.id,
    actorRole: String(viewer.role),
    assignment: { status: String(assignment.status), assignedToId: assignment.assignedToId, pickedUpById: assignment.pickedUpById },
    jobStatus: String(job.status),
  });
  const warnings = eligibility.ok
    ? await collectReopenMoneyFacts(job.id, review?.id ?? null)
        .then(reopenMoneyWarnings)
        .catch(() => ["Money linked to this inspection could not be checked. Look in Approvals before reopening."])
    : [];

  const primaryCleaner = issues[0]?.cleanerId ? job.assignments.find((entry) => entry.user?.id === issues[0].cleanerId)?.user : job.assignments[0]?.user;

  return {
    assignmentId: assignment.id,
    jobId: job.id,
    jobNumber: job.jobNumber,
    jobStatus: String(job.status),
    propertyName: job.property?.name ?? "Property",
    jobTypeLabel: jobTypeLabel(job.jobType),
    serviceDate: dayKey(job.scheduledDate, timeZone),
    cleanerNames,
    inspectorName: nameOf(assignment.pickedUpBy) ?? nameOf(assignment.assignedTo) ?? nameOf(submission.submittedBy),
    checkIn: assignment.checkInAt
      ? { at: assignment.checkInAt.toISOString(), method: assignment.checkInLat != null ? "gps" : "none", reason: null }
      : assignment.checkInSkippedReason
        ? { at: null, method: "remote", reason: assignment.checkInSkippedReason }
        : { at: null, method: "none", reason: null },
    submittedAt: (assignment.completedAt ?? submission.createdAt).toISOString(),
    templateLabel: submission.templateSnapshotName ?? submission.template?.name ?? "QA form",
    verdictOptions: [...verdictOptionsForScale(verdictScale)],
    areas,
    itemCount: areas.reduce((sum, area) => sum + area.items.length, 0),
    issueCount: issues.length,
    score: review
      ? {
          score: review.score,
          rawScore: review.rawScore != null && review.rawScore !== review.score ? review.rawScore : null,
          adjustmentReason: review.adjustmentReason,
          ratingLabel: ratingPresentation(review.rating, review.passed).label,
          ratingTone: ratingPresentation(review.rating, review.passed).tone,
          passed: review.passed,
          managementReview: review.managementReview,
          lines: buildScoreLines(issues, verdictScale),
        }
      : null,
    damage: readDamage(tools),
    nextClean: readNextClean(tools),
    evidence,
    whoFixes: buildWhoFixes({
      originalCleanerName: nameOf(primaryCleaner),
      offer: { status: assignment.reworkOfferStatus, offeredAt: assignment.reworkOfferedAt, expiresAt: assignment.reworkOfferExpiresAt },
      reworkJobs: reworkJobs.map((rework) => ({
        id: rework.id,
        jobNumber: rework.jobNumber,
        status: String(rework.status),
        createdAt: rework.createdAt,
        completedAt: rework.completedAt,
        payAmount: rework.reworkPayAmount,
        deductFromName: rework.reworkDeductFromCleanerId ? deductFromName.get(rework.reworkDeductFromCleanerId) ?? "the original cleaner" : null,
        assigneeNames: rework.assignments.map((entry) => nameOf(entry.user)).filter((name): name is string => Boolean(name)),
      })),
      transfers: transfers.map((transfer) => ({
        id: transfer.id,
        createdAt: transfer.createdAt,
        reviewedAt: transfer.reviewedAt,
        status: String(transfer.status),
        qaName: transfer.qaUser?.name ?? "The inspector",
        cleanerName: nameOf(transfer.cleaner) ?? "the cleaner",
        minutesFromCleaner: transfer.minutesFromCleaner,
        amountFromCleaner: transfer.amountFromCleaner,
      })),
      deduction: deduction ? { status: String(deduction.status), amount: deduction.requestedAmount } : null,
      issues,
      timeZone,
    }),
    signOff: readSignOff(tools),
    reopen: {
      eligible: eligibility.ok,
      blockedReason: eligibility.ok ? null : eligibility.message ?? "This inspection cannot be reopened.",
      warnings,
    },
    ai: {
      scoreReviewId: scoreReview?.id ?? null,
      coveredFieldIds: Array.from(new Set(coveringIssues.map((issue) => issue.fieldId).filter((id): id is string => Boolean(id)))),
      coveredMediaIds: Array.from(new Set(coveringIssues.flatMap((issue) => stringList(issue.cleanerMediaIds)))),
      deductedAnalysisIds: deductedAnalyses.map((analysis) => analysis.id),
    },
    timeZone,
  };
}
