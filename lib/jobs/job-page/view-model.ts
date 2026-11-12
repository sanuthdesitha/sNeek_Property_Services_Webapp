/**
 * Assembles the job page's display model from its reads: header actions,
 * stage bar, key facts, blockers, timeline facts and money. Pure apart from
 * its inputs, so the page file only renders.
 */
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_GEOFENCE_RADIUS_M } from "@/lib/gps/distance";
import { formNavigation } from "@/lib/forms/navigation";
import { isLiveInvoiceLine } from "@/lib/jobs/invoiced-rule";
import { restoreRefusal } from "@/lib/jobs/cancel-rules";
import { buildGuestSummary } from "@/lib/jobs/guest-summary";
import { parseJobInternalNotes, type JobMeta } from "@/lib/jobs/meta";
import { STATUS_LABELS } from "@/lib/jobs/status-labels";
import { formatServiceDate } from "@/lib/time/service-date";
import { jobBlockers } from "./blockers";
import { buildJobFacts, type ChecklistCount } from "./facts";
import { summarizeJobMoney, type JobRateCharge } from "./money";
import { CANCELLED_MENU_FOOTNOTE, JOB_MENU_FOOTNOTE, moreMenuFor } from "./more-menu";
import { jobStatusBadge, primaryActionFor, reminderEligibility, secondaryActionsFor } from "./primary-action";
import { jobStages } from "./stage-bar";
import { buildTimeline, type TimelineFacts } from "./timeline";
import type { JobPageJob, JobPageRelated } from "./load";

export type JobPageViewer = { isAdmin: boolean; readOnly: boolean };

/** Required items done / total for the latest submission, or null when it cannot be worked out. */
export function checklistCount(job: JobPageJob, property: Record<string, unknown>): ChecklistCount {
  const submission = job.formSubmissions[0];
  if (!submission || !submission.template?.schema) return null;
  try {
    const answers = submission.data && typeof submission.data === "object" ? (submission.data as Record<string, unknown>) : {};
    const uploads: Record<string, number> = {};
    for (const media of submission.media) uploads[media.fieldId] = (uploads[media.fieldId] ?? 0) + 1;
    const { rooms } = formNavigation(submission.template.schema, answers, uploads, property, submission.laundryReady ?? undefined);
    const visible = rooms.filter((room) => room.visible);
    return { done: visible.reduce((sum, room) => sum + room.done, 0), total: visible.reduce((sum, room) => sum + room.total, 0) };
  } catch {
    return null;
  }
}

function liveInvoiceOf(job: JobPageJob) {
  const lines = job.invoiceLines.filter((line) => line.invoice && isLiveInvoiceLine(line));
  const first = lines[0]?.invoice ?? null;
  if (!first) return null;
  const sameInvoice = lines.filter((line) => line.invoice?.id === first.id);
  return { ...first, lineTotal: sameInvoice.reduce((sum, line) => sum + line.lineTotal, 0), lines: sameInvoice };
}

export type JobLiveInvoiceView = NonNullable<ReturnType<typeof liveInvoiceOf>>;

export function buildJobPageModel(input: {
  job: JobPageJob;
  related: JobPageRelated;
  viewer: JobPageViewer;
  timeZone: string;
  now: Date;
  rateCharge: JobRateCharge;
  pendingTaskCount: number;
  pendingContinuationCount: number;
}) {
  const { job, related, viewer, timeZone, now } = input;
  const status = String(job.status);
  const meta: JobMeta = parseJobInternalNotes(job.internalNotes);
  const liveInvoice = liveInvoiceOf(job);
  const qa = job.qaReviews[0] ?? null;
  const reworkFlags = qa && !qa.passed && Array.isArray(qa.flags) ? (qa.flags as unknown[]).map(String) : [];
  const openLog = job.timeLogs.find((log) => log.stoppedAt === null) ?? null;
  const runningSince = openLog?.startedAt ?? job.timeLogs[job.timeLogs.length - 1]?.startedAt ?? null;
  const reminder = reminderEligibility({ status, runningSince, now });
  const refusal = status === "CANCELLED" ? restoreRefusal({ status, cancelledFromStatus: job.cancelledFromStatus }) : null;
  const skipStatus = String(job.cleanSkipStatus ?? "NONE");
  const hasSubmission = job.formSubmissions.length > 0;

  const primary = primaryActionFor({
    jobId: job.id,
    status,
    liveInvoice: liveInvoice ? { id: liveInvoice.id, invoiceNumber: liveInvoice.invoiceNumber } : null,
    restoreRefusal: refusal,
    readOnly: viewer.readOnly,
  });
  const secondary = secondaryActionsFor({ jobId: job.id, status, reminder, hasSubmission, readOnly: viewer.readOnly });
  const menu = moreMenuFor({
    jobId: job.id,
    status,
    actorIsAdmin: viewer.isAdmin,
    readOnly: viewer.readOnly,
    reminder,
    hasSubmission,
    hasTimeLogs: job.timeLogs.length > 0,
    skipStatus,
  });

  const stages = jobStages({
    status,
    hasAssignment: job.assignments.length > 0,
    hasTimeLog: job.timeLogs.length > 0,
    hasSubmission,
    completedAt: job.completedAt,
    hasLiveInvoiceLine: liveInvoice !== null,
    liveInvoiceStatus: liveInvoice?.status ?? null,
  });

  const money = summarizeJobMoney({
    rateCharge: input.rateCharge,
    assignments: job.assignments.map((a) => ({ userId: a.userId, name: a.user?.name ?? a.user?.email ?? "Cleaner", isPrimary: a.isPrimary, payRate: a.payRate })),
    actualHours: job.actualHours,
    estimatedHours: job.estimatedHours,
    cleanerPayouts: meta.cleanerPayouts,
    transportAllowances: meta.transportAllowances,
    liveInvoice: liveInvoice ? { invoiceNumber: liveInvoice.invoiceNumber, status: String(liveInvoice.status), lineTotal: liveInvoice.lineTotal } : null,
  });

  const nextGuest = buildGuestSummary(meta.reservationContext);
  const checkinAt = nextGuest.checkinAtLocal && Number.isFinite(Date.parse(nextGuest.checkinAtLocal)) ? new Date(nextGuest.checkinAtLocal) : null;
  const serviceDateKey = formatServiceDate(job.scheduledDate, "yyyy-MM-dd", "");
  const facts = buildJobFacts({
    timeZone,
    departing: job.reservation ? { name: job.reservation.guestName, checkoutAt: job.reservation.checkoutAtLocal ?? null } : null,
    arriving: nextGuest.hasAnything ? { name: nextGuest.name, checkinAt } : null,
    sameDayCheckin: job.sameDayCheckin,
    sameDayCheckinTime: job.sameDayCheckinTime,
    serviceDateKey,
    timeLogs: job.timeLogs.map((log) => ({ startedAt: log.startedAt, stoppedAt: log.stoppedAt })),
    allocatedHours: job.estimatedHours,
    now,
    checklist: checklistCount(job, related.propertyRecord),
    flaggedCount: reworkFlags.length,
    money,
  });

  const blockers = jobBlockers({
    status,
    pendingTaskRequests: input.pendingTaskCount,
    pendingContinuations: input.pendingContinuationCount,
    clockInDistanceM: job.gpsDistanceMeters,
    geofenceRadiusM: job.property?.geofenceRadiusM ?? DEFAULT_GEOFENCE_RADIUS_M,
    skipStatus,
  });

  const time = (date: Date) => formatInTimeZone(date, timeZone, "HH:mm");
  const firstStart = job.timeLogs[0]?.startedAt ?? null;
  const stopped = job.timeLogs.filter((log) => log.stoppedAt).map((log) => (log.stoppedAt as Date).getTime());
  const latestSubmission = job.formSubmissions[0] ?? null;
  const timelineFacts: TimelineFacts = {
    status,
    hasAssignment: job.assignments.length > 0,
    acceptedCount: job.assignments.filter((a) => String(a.responseStatus) === "ACCEPTED").length,
    assignmentCount: job.assignments.length,
    hasTimeLog: job.timeLogs.length > 0,
    clockRunning: openLog !== null,
    hasSubmission,
    hasQaReview: qa !== null,
    qaPassed: qa?.passed ?? null,
    qaScore: qa?.score ?? null,
    qaInspectorName: related.qaAssignment?.assignedTo?.name ?? related.qaAssignment?.assignedTo?.email ?? null,
    reportExists: job.report !== null,
    reportSent: job.report?.sentToClient === true,
    laundry: {
      exists: job.laundryTask !== null,
      supplierName: job.laundryTask?.supplier?.name ?? null,
      finished: job.laundryTask ? job.laundryTask.noPickupRequired || job.laundryTask.droppedAt !== null : false,
    },
    liveInvoice: liveInvoice ? { invoiceNumber: liveInvoice.invoiceNumber, status: String(liveInvoice.status) } : null,
    formName: latestSubmission?.template?.name ?? null,
    bookingSource: job.reservation?.source ?? null,
    hasReservation: job.reservation !== null,
    siteWindow: firstStart && stopped.length > 0 && !openLog ? `${time(firstStart)} – ${time(new Date(Math.max(...stopped)))}` : null,
    runningSinceLabel: openLog ? time(openLog.startedAt) : null,
    submittedLabel: latestSubmission
      ? `Submitted ${formatInTimeZone(latestSubmission.createdAt, timeZone, "d MMM HH:mm")} by ${latestSubmission.submittedBy?.name ?? latestSubmission.submittedBy?.email ?? "the cleaner"}`
      : null,
  };

  return {
    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    badge: jobStatusBadge(status),
    meta,
    qa,
    reworkFlags,
    liveInvoice,
    openLog,
    reminder,
    restoreRefusal: refusal,
    skipStatus,
    primary,
    secondary,
    menu,
    menuFootnote: status === "CANCELLED" ? CANCELLED_MENU_FOOTNOTE : JOB_MENU_FOOTNOTE,
    stages,
    money,
    facts,
    blockers,
    timeline: buildTimeline(timelineFacts),
    nextGuest,
  };
}

export type JobPageModel = ReturnType<typeof buildJobPageModel>;
