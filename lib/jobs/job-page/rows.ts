/**
 * Serialised rows for the existing client review components, built from the
 * job page's reads. Moved unchanged from the old page so every component keeps
 * receiving exactly the payload it was written for.
 */
import type { JobContinuationRow, TaskRequestRow } from "@/components/v2/admin/jobs/job-detail-reviews";
import type { SubmissionRow } from "@/components/v2/admin/jobs/submission-review";
import type { ContinuationRequest } from "@/lib/jobs/continuation-requests";
import type { JobPageJob } from "./load";

const PROOF_KINDS = new Set(["COMPLETION_PROOF", "FAILURE_PROOF"]);

export function buildTaskRows(job: JobPageJob): TaskRequestRow[] {
  return job.jobTasks.map((task) => {
    const reviewEvent = task.events.find(
      (event) => (event.action === "CLIENT_TASK_APPROVED" || event.action === "CLIENT_TASK_REJECTED") && event.note,
    );
    // What the cleaner wrote when finishing (events are newest first).
    const completionEvent = task.events.find(
      (event) => event.action === "TASK_COMPLETED" || event.action === "TASK_NOT_COMPLETED" || event.action === "TASK_NOT_APPLICABLE",
    );
    // Reference images stay separate from proof: one is what was asked for,
    // the other is what came back.
    const reference = task.attachments.filter((att) => !PROOF_KINDS.has(String(att.kind)));
    const proof = task.attachments.filter((att) => PROOF_KINDS.has(String(att.kind)));
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      approvalStatus: String(task.approvalStatus),
      executionStatus: String(task.executionStatus),
      requiresPhoto: task.requiresPhoto,
      requiresNote: task.requiresNote,
      createdAt: task.createdAt.toISOString(),
      requestedBy: task.requestedBy?.name ?? task.requestedBy?.email ?? null,
      reviewNote: reviewEvent?.note ?? null,
      source: String(task.source),
      completedAt: task.completedAt?.toISOString() ?? null,
      completionNote: completionEvent?.note ?? null,
      completionDisposition: completionEvent?.action === "TASK_NOT_APPLICABLE" ? "NOT_APPLICABLE" : null,
      attachments: reference.map((att) => ({ id: att.id, url: att.url, s3Key: att.s3Key, label: att.label, mediaType: String(att.mediaType) })),
      proof: proof.map((att) => ({ id: att.id, url: att.url, s3Key: att.s3Key, label: att.label, mediaType: String(att.mediaType), kind: String(att.kind) })),
    };
  });
}

export function buildContinuationRows(rows: ContinuationRequest[], names: Map<string, string>): JobContinuationRow[] {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    reason: row.reason,
    requestedAt: row.requestedAt,
    requestedBy: names.get(row.requestedByUserId) ?? row.requestedByUserId,
    preferredDate: row.preferredDate,
    estimatedRemainingHours: row.estimatedRemainingHours,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedByUserId ? names.get(row.decidedByUserId) ?? row.decidedByUserId : null,
    decisionNote: row.decisionNote,
    continuationJobId: row.continuationJobId,
    loggedCleaners: Array.isArray(row.snapshot?.loggedMinutesByCleaner)
      ? row.snapshot.loggedMinutesByCleaner.map((entry) => ({ cleanerName: entry.cleanerName, minutes: entry.minutes }))
      : [],
  }));
}

export function buildSubmissionRows(job: JobPageJob): SubmissionRow[] {
  return job.formSubmissions.map((sub) => ({
    id: sub.id,
    createdAt: sub.createdAt.toISOString(),
    data: sub.data && typeof sub.data === "object" ? (sub.data as Record<string, unknown>) : {},
    laundryReady: sub.laundryReady,
    laundryOutcome: sub.laundryOutcome ? String(sub.laundryOutcome) : null,
    bagLocation: sub.bagLocation,
    autoQaScore: sub.autoQaScore,
    templateName: sub.template?.name ?? "Job form",
    schema: sub.template?.schema && typeof sub.template.schema === "object" ? (sub.template.schema as { sections?: unknown }) : null,
    submittedBy: sub.submittedBy?.name ?? sub.submittedBy?.email ?? "Cleaner",
    media: sub.media.map((media) => ({
      id: media.id,
      fieldId: media.fieldId,
      mediaType: String(media.mediaType),
      url: media.url,
      s3Key: media.s3Key,
      label: media.label,
    })),
    stockTxs: sub.stockTxs.map((tx) => ({
      quantity: tx.quantity,
      itemName: tx.propertyStock?.item?.name ?? tx.propertyStock?.itemId ?? "Item",
    })),
  }));
}

/** The record the inline manage editor (JobManagePanel) reads; read-only here. */
export function buildManageJob(job: JobPageJob) {
  const submission = job.formSubmissions[0] ?? null;
  return {
    id: job.id,
    updatedAt: job.updatedAt.toISOString(),
    jobTasks: job.jobTasks.map((task) => ({
      id: task.id,
      source: task.source,
      executionStatus: task.executionStatus,
      title: task.title,
      description: task.description,
      requiresPhoto: task.requiresPhoto,
      requiresNote: task.requiresNote,
      metadata: task.metadata,
    })),
    jobNumber: job.jobNumber,
    jobType: job.jobType,
    status: job.status,
    scheduledDate: job.scheduledDate.toISOString(),
    startTime: job.startTime,
    dueTime: job.dueTime,
    endTime: job.endTime,
    estimatedHours: job.estimatedHours,
    actualHours: job.actualHours,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    notes: job.notes,
    fixedPrice: job.fixedPrice,
    invoiceNote: job.invoiceNote,
    internalNotes: job.internalNotes,
    cleanSkipStatus: job.cleanSkipStatus,
    property: { name: job.property?.name ?? null },
    assignments: job.assignments.map((assignment) => ({
      userId: assignment.userId,
      isPrimary: assignment.isPrimary,
      payRate: assignment.payRate,
      user: { id: assignment.user?.id ?? assignment.userId, name: assignment.user?.name ?? null, email: assignment.user?.email ?? null },
    })),
    submission: submission
      ? {
          id: submission.id,
          laundryReady: submission.laundryReady,
          laundryOutcome: submission.laundryOutcome ? String(submission.laundryOutcome) : null,
          bagLocation: submission.bagLocation,
        }
      : null,
  };
}

export type JobPageManageJob = ReturnType<typeof buildManageJob>;

export function buildPanelAssignments(job: JobPageJob) {
  return job.assignments.map((assignment) => ({
    id: assignment.id,
    isPrimary: assignment.isPrimary,
    responseStatus: String(assignment.responseStatus),
    userId: assignment.userId,
    name: assignment.user?.name ?? assignment.user?.email ?? "Cleaner",
    email: assignment.user?.email ?? null,
  }));
}
