import Link from "next/link";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { JobStatus, JobTaskSource, QaAssignmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { jobDetailTabHref, resolveJobDetailTab } from "@/lib/jobs/detail-tabs";
import { ClockRecordsEditor, GpsRecordEditor } from "@/components/v2/admin/jobs/job-clock-gps-editor";
import { ClockLocationsMap } from "@/components/shared/clock-locations-map";
import { buildGuestCountLabel, buildGuestSummary } from "@/lib/jobs/guest-summary";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  ETabs,
  type ETabItem,
} from "@/components/v2/ui/primitives";
import {
  ArrowLeft,
  ClipboardList,
  Clock,
  History,
  Link2,
  ListChecks,
  MapPin,
  MessageCircle,
  CalendarDays,
  PackagePlus,
  Phone,
  Receipt,
  RefreshCw,
  Shirt,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { QuickQaReview } from "@/components/v2/admin/jobs/quick-qa-review";
import { JobAssignPanel } from "@/components/v2/admin/jobs/job-assign-panel";
import { QaAssignPanel } from "@/components/v2/admin/jobs/qa-assign-panel";
import {
  JobContinuationReviews,
  JobDetailManage,
  TaskRequestReviews,
  type JobContinuationRow,
  type TaskRequestRow,
} from "@/components/v2/admin/jobs/job-detail-reviews";
import { SubmissionReview, type SubmissionRow } from "@/components/v2/admin/jobs/submission-review";
import { JobExtrasPanel } from "@/components/v2/admin/jobs/job-extras-panel";
import { JobChatAdmin } from "@/components/v2/admin/jobs/job-chat-admin";
import { ReportActions } from "@/components/v2/admin/jobs/report-actions";
import { FormsQaCentre } from "@/components/v2/admin/jobs/forms-qa-centre";
import { TaskEvidence } from "@/components/v2/admin/jobs/task-evidence";
import { JobReminderButton } from "@/components/v2/admin/jobs/job-reminder-button";

export const metadata = { title: "Job · Estate admin" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function statusTone(status: JobStatus): Tone {
  switch (status) {
    case JobStatus.UNASSIGNED:
    case JobStatus.OFFERED:
      return "warning";
    case JobStatus.ASSIGNED:
    case JobStatus.EN_ROUTE:
      return "primary";
    case JobStatus.IN_PROGRESS:
    case JobStatus.PAUSED:
    case JobStatus.WAITING_CONTINUATION_APPROVAL:
      return "info";
    case JobStatus.SUBMITTED:
      return "warning";
    case JobStatus.QA_REVIEW:
      return "aubergine";
    case JobStatus.COMPLETED:
    case JobStatus.INVOICED:
      return "success";
    default:
      return "neutral";
  }
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-AU");
}

async function getJob(id: string) {
  return db.job
    .findUnique({
      where: { id },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        endTime: true,
        estimatedHours: true,
        actualHours: true,
        fixedPrice: true,
        invoiceNote: true,
        notes: true,
        internalNotes: true,
        cleanSkipStatus: true,
        completedAt: true,
        gpsCheckInLat: true,
        gpsCheckInLng: true,
        gpsCheckInAt: true,
        gpsCheckInAccuracyM: true,
        gpsCheckOutLat: true,
        gpsCheckOutLng: true,
        gpsCheckOutAt: true,
        gpsDistanceMeters: true,
        gpsCheckInReasonCode: true,
        gpsCheckInNote: true,
        gpsCheckInAdjusted: true,
        sameDayCheckin: true,
        sameDayCheckinTime: true,
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            suburb: true,
            // lat/lng anchor the clock-in/out map below.
            latitude: true,
            longitude: true,
            client: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
        // Everything the iCal feed gave us for this job's booking.
        reservation: {
          select: {
            uid: true,
            startDate: true,
            endDate: true,
            summary: true,
            guestName: true,
            reservationCode: true,
            guestPhone: true,
            guestEmail: true,
            guestProfileUrl: true,
            adults: true,
            children: true,
            infants: true,
            locationText: true,
            checkinAtLocal: true,
            checkoutAtLocal: true,
            source: true,
          },
        },
        assignments: {
          where: { removedAt: null },
          orderBy: { isPrimary: "desc" },
          select: {
            id: true,
            isPrimary: true,
            responseStatus: true,
            userId: true,
            payRate: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        issueTickets: {
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            title: true,
            caseType: true,
            severity: true,
            state: true,
            status: true,
            createdAt: true,
          },
        },
        invoiceLines: {
          orderBy: { createdAt: "desc" },
          take: 12,
          select: {
            id: true,
            description: true,
            lineTotal: true,
            category: true,
            invoice: { select: { invoiceNumber: true, status: true, totalAmount: true } },
          },
        },
        qaReviews: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            score: true,
            passed: true,
            notes: true,
            kind: true,
            createdAt: true,
            flags: true,
            // Drives the "share this inspection with the cleaner" toggle.
            cleanerReportVisible: true,
          },
        },
        report: { select: { clientVisible: true, sentToClient: true } },
        // Planned dates AND the actual stamps — showing only pickupDate/
        // dropoffDate made the laundry read as "scheduled" when it had already
        // happened (or hadn't), which is the timing complaint in CP-9.
        laundryTask: {
          select: {
            status: true,
            pickupDate: true,
            dropoffDate: true,
            flagNotes: true,
            confirmedAt: true,
            pickedUpAt: true,
            droppedAt: true,
            noPickupRequired: true,
            bagWeightKg: true,
            dropoffCostAud: true,
            receiptImageUrl: true,
            pickupKeyPhotoUrl: true,
            dropoffKeyPhotoUrl: true,
            supplier: { select: { name: true } },
            confirmations: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                laundryReady: true,
                bagLocation: true,
                photoUrl: true,
                notes: true,
                createdAt: true,
              },
            },
          },
        },
        timeLogs: {
          orderBy: { startedAt: "asc" },
          select: {
            id: true,
            startedAt: true,
            stoppedAt: true,
            durationM: true,
            user: { select: { name: true, email: true } },
          },
        },
        formSubmissions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            data: true,
            laundryReady: true,
            laundryOutcome: true,
            bagLocation: true,
            autoQaScore: true,
            template: { select: { name: true, schema: true } },
            submittedBy: { select: { name: true, email: true } },
            media: {
              orderBy: { createdAt: "asc" },
              select: { id: true, fieldId: true, mediaType: true, url: true, s3Key: true, label: true },
            },
            stockTxs: {
              select: {
                quantity: true,
                propertyStock: { select: { itemId: true, item: { select: { name: true } } } },
              },
            },
          },
        },
        jobTasks: {
          // CARRY_FORWARD tasks belong to the job they were carried TO and
          // surface there on their own. Admin-raised tasks were excluded
          // outright, which is why an admin could ask for something and
          // never see whether it was done.
          where: { source: { in: [JobTaskSource.CLIENT, JobTaskSource.ADMIN] } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            description: true,
            source: true,
            approvalStatus: true,
            executionStatus: true,
            completedAt: true,
            requiresPhoto: true,
            requiresNote: true,
            createdAt: true,
            requestedBy: { select: { name: true, email: true } },
            // Every kind: the reference images that came WITH the request,
            // and the proof the cleaner uploaded when finishing it.
            attachments: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                url: true,
                s3Key: true,
                label: true,
                mediaType: true,
                kind: true,
              },
            },
            events: {
              orderBy: { createdAt: "desc" },
              select: { action: true, note: true },
            },
          },
        },
      },
    })
    .catch(() => null);
}

export default async function AdminJobDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const job = await getJob(params.id);
  if (!job) notFound();

  // Continuation requests (file-backed store, same source as the v1 console
  // and the admin API) + audit trail, loaded alongside the job.
  const [continuations, auditRows, fullProperty, qaAssignment, qaEligibleUsers] = await Promise.all([
    listContinuationRequests({ jobId: job.id }).catch(() => []),
    db.auditLog
      .findMany({
        where: { jobId: job.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      })
      .catch(() => []),
    job.property
      ? db.property.findUnique({ where: { id: job.property.id } }).catch(() => null)
      : Promise.resolve(null),
    // The job's current ACTIVE QA assignment (not cancelled/completed) for the
    // QA assign panel.
    db.qaAssignment
      .findFirst({
        where: {
          jobId: job.id,
          status: { notIn: [QaAssignmentStatus.CANCELLED, QaAssignmentStatus.COMPLETED] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          assignedToId: true,
          earlyStartReason: true,
          assignedTo: { select: { name: true, email: true } },
        },
      })
      .catch(() => null),
    // Eligible QA assignees — same roster rule as /api/admin/qa/assignments.
    db.user
      .findMany({
        where: { role: { in: [Role.QA_INSPECTOR, Role.OPS_MANAGER] }, isActive: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
      })
      .catch(() => []),
  ]);

  // Resolve requester / decider names for continuation rows.
  const continuationUserIds = Array.from(
    new Set(
      continuations
        .flatMap((row) => [row.requestedByUserId, row.decidedByUserId])
        .filter((id): id is string => Boolean(id))
    )
  );
  const continuationUsers = continuationUserIds.length
    ? await db.user
        .findMany({
          where: { id: { in: continuationUserIds } },
          select: { id: true, name: true, email: true },
        })
        .catch(() => [])
    : [];
  const userNameById = new Map(continuationUsers.map((u) => [u.id, u.name ?? u.email ?? u.id]));

  const qa = job.qaReviews[0] ?? null;
  const reworkFlags: string[] =
    qa && !qa.passed && Array.isArray(qa.flags) ? (qa.flags as unknown[]).map((f) => String(f)) : [];

  // Planned date vs the actual stamp for each leg of the laundry run.
  const laundryTimingRows = (() => {
    const t = job.laundryTask;
    if (!t) return [] as Array<{ label: string; planned: string; actual: string | null }>;
    return [
      {
        label: "Pickup",
        planned: format(new Date(t.pickupDate), "d MMM"),
        actual: t.pickedUpAt ? format(new Date(t.pickedUpAt), "d MMM HH:mm") : null,
      },
      {
        label: "Drop-off",
        planned: format(new Date(t.dropoffDate), "d MMM"),
        actual: t.droppedAt ? format(new Date(t.droppedAt), "d MMM HH:mm") : null,
      },
    ];
  })();

  const laundryImages = (() => {
    const t = job.laundryTask;
    if (!t) return [] as Array<{ url: string; label: string }>;
    const rows: Array<{ url: string; label: string }> = [];
    if (t.pickupKeyPhotoUrl) rows.push({ url: t.pickupKeyPhotoUrl, label: "Key at pickup" });
    if (t.dropoffKeyPhotoUrl) rows.push({ url: t.dropoffKeyPhotoUrl, label: "Key returned at drop-off" });
    if (t.receiptImageUrl) rows.push({ url: t.receiptImageUrl, label: "Drop-off receipt" });
    for (const c of t.confirmations) {
      if (c.photoUrl) {
        rows.push({ url: c.photoUrl, label: `Confirmation ${format(new Date(c.createdAt), "d MMM")}` });
      }
    }
    return rows;
  })();

  const scheduledLabel = (() => {
    const parsed = new Date(job.scheduledDate);
    return Number.isNaN(parsed.getTime()) ? "Date not set" : format(parsed, "EEEE d MMMM yyyy");
  })();
  const timeLabel = job.startTime
    ? `${job.startTime}${job.dueTime ? ` – ${job.dueTime}` : ""}${job.endTime ? ` (ended ${job.endTime})` : ""}`
    : "No time set";
  const propLabel = [job.property?.name, job.property?.suburb].filter(Boolean).join(" · ") || "Property";

  /* ── Serialized rows for the client review components ─────────────────── */

  const taskRows: TaskRequestRow[] = job.jobTasks.map((task) => {
    const reviewEvent = task.events.find(
      (e) => (e.action === "CLIENT_TASK_APPROVED" || e.action === "CLIENT_TASK_REJECTED") && e.note
    );
    // What the cleaner wrote when marking it done, or explaining why they
    // could not. Events are newest-first, so this is the latest word.
    const completionEvent = task.events.find(
      (e) => e.action === "TASK_COMPLETED" || e.action === "TASK_NOT_COMPLETED"
    );
    const isProof = (kind: string) =>
      kind === "COMPLETION_PROOF" || kind === "FAILURE_PROOF";
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
      // Reference images stay separate from proof: one is what was asked
      // for, the other is what came back, and merging them would make an
      // unfinished task look evidenced.
      attachments: task.attachments
        .filter((att) => !isProof(String(att.kind)))
        .map((att) => ({
          id: att.id,
          url: att.url,
          s3Key: att.s3Key,
          label: att.label,
          mediaType: String(att.mediaType),
        })),
      proof: task.attachments
        .filter((att) => isProof(String(att.kind)))
        .map((att) => ({
          id: att.id,
          url: att.url,
          s3Key: att.s3Key,
          label: att.label,
          mediaType: String(att.mediaType),
          kind: String(att.kind),
        })),
    };
  });

  const continuationRows: JobContinuationRow[] = continuations.map((row) => ({
    id: row.id,
    status: row.status,
    reason: row.reason,
    requestedAt: row.requestedAt,
    requestedBy: userNameById.get(row.requestedByUserId) ?? row.requestedByUserId,
    preferredDate: row.preferredDate,
    estimatedRemainingHours: row.estimatedRemainingHours,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedByUserId ? userNameById.get(row.decidedByUserId) ?? row.decidedByUserId : null,
    decisionNote: row.decisionNote,
    continuationJobId: row.continuationJobId,
    loggedCleaners: Array.isArray(row.snapshot?.loggedMinutesByCleaner)
      ? row.snapshot.loggedMinutesByCleaner.map((c) => ({ cleanerName: c.cleanerName, minutes: c.minutes }))
      : [],
  }));

  const submissionRows: SubmissionRow[] = job.formSubmissions.map((sub) => ({
    id: sub.id,
    createdAt: sub.createdAt.toISOString(),
    data: sub.data && typeof sub.data === "object" ? (sub.data as Record<string, unknown>) : {},
    laundryReady: sub.laundryReady,
    laundryOutcome: sub.laundryOutcome ? String(sub.laundryOutcome) : null,
    bagLocation: sub.bagLocation,
    autoQaScore: sub.autoQaScore,
    templateName: sub.template?.name ?? "Job form",
    schema:
      sub.template?.schema && typeof sub.template.schema === "object"
        ? (sub.template.schema as { sections?: unknown })
        : null,
    submittedBy: sub.submittedBy?.name ?? sub.submittedBy?.email ?? "Cleaner",
    media: sub.media.map((m) => ({
      id: m.id,
      fieldId: m.fieldId,
      mediaType: String(m.mediaType),
      url: m.url,
      s3Key: m.s3Key,
      label: m.label,
    })),
    stockTxs: sub.stockTxs.map((tx) => ({
      quantity: tx.quantity,
      itemName: tx.propertyStock?.item?.name ?? tx.propertyStock?.itemId ?? "Item",
    })),
  }));

  // Plain property record for conditional sections/fields in the form schema.
  const propertyRecord: Record<string, unknown> = fullProperty
    ? (JSON.parse(JSON.stringify(fullProperty)) as Record<string, unknown>)
    : {};

  // Full field set for the manage modal (v1 "Edit Job" parity). The board's
  // list query already carries these on its job objects; the detail page must
  // pass them explicitly. All read-only here — the modal owns the mutations.
  const manageSubmission = job.formSubmissions[0] ?? null;
  const manageJob = {
    id: job.id,
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
    assignments: job.assignments.map((a) => ({
      userId: a.userId,
      isPrimary: a.isPrimary,
      payRate: a.payRate,
      user: { id: a.user?.id ?? a.userId, name: a.user?.name ?? null, email: a.user?.email ?? null },
    })),
    submission: manageSubmission
      ? {
          id: manageSubmission.id,
          laundryReady: manageSubmission.laundryReady,
          laundryOutcome: manageSubmission.laundryOutcome ? String(manageSubmission.laundryOutcome) : null,
          bagLocation: manageSubmission.bagLocation,
        }
      : null,
  };

  const pendingTaskCount = taskRows.filter((t) => t.approvalStatus === "PENDING_APPROVAL").length;
  const pendingContinuations = continuationRows.filter((r) => r.status === "PENDING").length;

  /* ── Assign panel + money transparency ────────────────────────────────── */

  const panelAssignments = job.assignments.map((a) => ({
    id: a.id,
    isPrimary: a.isPrimary,
    responseStatus: String(a.responseStatus),
    userId: a.userId,
    name: a.user?.name ?? a.user?.email ?? "Cleaner",
    email: a.user?.email ?? null,
  }));

  // Per-cleaner pay: custom payout overrides the hours × rate estimate; transport
  // is added on top. Same inputs the payroll + v1 billing panel read from.
  const jobMeta = parseJobInternalNotes(job.internalNotes);

  // The guest ARRIVING after this clean. Job.reservation is the booking whose
  // checkout triggered the job — i.e. the guest who just left — so it must not
  // be read as "the guest for this job". See lib/jobs/guest-summary.ts.
  const nextGuest = buildGuestSummary(jobMeta.reservationContext);

  // Counts for the departing booking, shown in the secondary block below.
  const departingGuestCountLabel = job.reservation
    ? buildGuestCountLabel({
        adults: job.reservation.adults,
        children: job.reservation.children,
        infants: job.reservation.infants,
      })
    : null;
  const payHours = job.actualHours ?? job.estimatedHours ?? null;
  const payRows = job.assignments.map((a) => {
    const custom = jobMeta.cleanerPayouts[a.userId];
    const transport = jobMeta.transportAllowances[a.userId] ?? 0;
    const base =
      custom != null
        ? custom
        : a.payRate != null && payHours != null
          ? a.payRate * payHours
          : null;
    const total = (base ?? 0) + transport;
    return {
      id: a.id,
      name: a.user?.name ?? a.user?.email ?? "Cleaner",
      isPrimary: a.isPrimary,
      rate: a.payRate,
      custom: custom ?? null,
      transport,
      base,
      total,
      estimated: base == null,
    };
  });
  const cleanerCost = payRows.reduce((sum, row) => sum + row.total, 0);
  const anyEstimated = payRows.some((row) => row.estimated);
  const clientCharge = job.fixedPrice;
  const margin = clientCharge != null ? clientCharge - cleanerCost : null;
  const marginPct =
    clientCharge != null && clientCharge > 0 ? Math.round(((margin ?? 0) / clientCharge) * 100) : null;

  // "Send reminder" is offered when the job is PAUSED, or has been IN_PROGRESS
  // for more than 24h (running-since = earliest open TimeLog, else latest log).
  const openLogs = job.timeLogs.filter((log) => log.stoppedAt === null);
  const runningSince = openLogs[0]?.startedAt ?? job.timeLogs[job.timeLogs.length - 1]?.startedAt ?? null;
  const staleInProgress =
    job.status === JobStatus.IN_PROGRESS &&
    runningSince != null &&
    Date.now() - runningSince.getTime() > 24 * 60 * 60 * 1000;
  const showReminderButton = job.status === JobStatus.PAUSED || staleInProgress;

  const linkedCases = job.issueTickets ?? [];
  const linkedInvoiceLines = job.invoiceLines ?? [];
  const hasLinkedRefs = linkedCases.length > 0 || linkedInvoiceLines.length > 0;

  const tab = resolveJobDetailTab(searchParams?.tab);
  const tabHref = (key: string) => jobDetailTabHref(job.id, key);
  const skipStatus = String(job.cleanSkipStatus ?? "NONE");
  const tabItems: ETabItem[] = [
    { key: "overview", label: "Overview" },
    { key: "schedule", label: "Schedule" },
    { key: "people", label: "People" },
    { key: "quality", label: "Quality" },
    { key: "laundry", label: "Laundry" },
    { key: "money", label: "Money" },
    { key: "forms", label: "Forms & report" },
    {
      key: "scope",
      label: "Scope & requests",
      badge:
        pendingTaskCount > 0 ? (
          <EBadge tone="warning" soft>{pendingTaskCount}</EBadge>
        ) : null,
    },
    { key: "messages", label: "Messages" },
    { key: "activity", label: "Activity" },
    { key: "danger", label: "Danger" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <EButton asChild variant="ghost" size="icon"><Link href="/v2/admin/jobs" aria-label="Back to jobs board"><ArrowLeft className="h-4 w-4" /></Link></EButton>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Jobs · {job.jobNumber}</span>
      </div>

      <EPageHeader
        eyebrow={titleCase(job.jobType)}
        title={propLabel}
        description={`${scheduledLabel} · ${timeLabel}`}
        actions={
          <div className="flex items-center gap-2">
            <EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge>
            {jobMeta.isDraft ? <EBadge tone="neutral" soft>Draft</EBadge> : null}
            {skipStatus === "REQUESTED" ? <EBadge tone="warning" soft>Skip requested</EBadge> : null}
            {skipStatus === "SKIPPED" ? <EBadge tone="danger" soft>Skipped</EBadge> : null}
            {showReminderButton ? <JobReminderButton jobId={job.id} statusLabel={titleCase(job.status)} /> : null}
          </div>
        }
      />

      <ETabs items={tabItems} active={tab} hrefFor={tabHref} ariaLabel="Job sections" />

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {tab === "overview" ? (
      <div className="grid gap-4 md:grid-cols-2">
        {/* Property & client */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="flex items-center gap-2 text-[0.95rem]"><MapPin className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Property &amp; client</ECardTitle></ECardHeader>
          <ECardBody className="space-y-1 pt-0 text-[0.8125rem]">
            <p className="font-[550]">{job.property?.name ?? "Property"}</p>
            <p className="text-[hsl(var(--e-muted-foreground))]">
              {job.property?.address ?? "—"}{job.property?.suburb ? `, ${job.property.suburb}` : ""}
            </p>
            {job.property?.client ? (
              <div className="pt-1">
                <p className="text-[hsl(var(--e-text-secondary))]">
                  Client:{" "}
                  <Link href={`/v2/admin/clients/${job.property.client.id}`} className="font-medium text-[hsl(var(--e-accent-portal))] hover:underline">
                    {job.property.client.name}
                  </Link>
                </p>
                {/* Contact details, as v1 had them — admin needs to reach the
                    client from the job without a detour via the client page. */}
                {job.property.client.phone ? (
                  <p className="text-[hsl(var(--e-muted-foreground))]">
                    <a href={`tel:${job.property.client.phone}`} className="hover:underline">
                      {job.property.client.phone}
                    </a>
                  </p>
                ) : null}
                {job.property.client.email ? (
                  <p className="text-[hsl(var(--e-muted-foreground))]">
                    <a href={`mailto:${job.property.client.email}`} className="hover:underline">
                      {job.property.client.email}
                    </a>
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="text-[hsl(var(--e-muted-foreground))]">Type: {titleCase(job.jobType)}</p>
          </ECardBody>
        </ECard>

        {/* Schedule */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Schedule</ECardTitle></ECardHeader>
          <ECardBody className="space-y-1 pt-0 text-[0.8125rem]">
            <p className="text-[hsl(var(--e-text-secondary))]">{scheduledLabel}</p>
            <p className="text-[hsl(var(--e-muted-foreground))] tabular-nums">{timeLabel}</p>
            {job.estimatedHours != null ? (
              <p className="text-[hsl(var(--e-muted-foreground))]">Allocated: {job.estimatedHours}h{job.actualHours != null ? ` · actual ${job.actualHours}h` : ""}</p>
            ) : null}
            {job.completedAt ? (
              <p className="text-[hsl(var(--e-muted-foreground))]">Completed {format(new Date(job.completedAt), "d MMM yyyy")}</p>
            ) : null}
            {/* Same-day check-in: a new guest arrives the day of this clean, so
                the clean cannot run late. v1 showed it; v2 did not select it. */}
            {job.sameDayCheckin ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] px-2.5 py-1.5">
                <EBadge tone="warning" soft>Same-day check-in</EBadge>
                {job.sameDayCheckinTime ? (
                  <span className="text-[0.75rem] tabular-nums">Guest arrives {job.sameDayCheckinTime}</span>
                ) : null}
              </div>
            ) : null}
          </ECardBody>
        </ECard>

        {/* iCal feed data for this job's booking. Everything the sync captured,
            shown in full — admin previously had to open the property's sync log
            to see who was staying. */}
        {nextGuest.hasAnything || job.reservation ? (
          <ECard>
            <ECardHeader className="pb-2">
              <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
                <CalendarDays className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Guests (iCal)
              </ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-3 pt-0 text-[0.8125rem]">
              {/* ARRIVING guest first — this is who the property is being
                  prepared for. Comes from jobMeta.reservationContext, which the
                  sync builds from the incoming booking. */}
              {nextGuest.hasAnything ? (
                <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <EBadge tone="success" soft>Arriving next</EBadge>
                    {nextGuest.checkinAtLocal ? (
                      <span className="tabular-nums text-[hsl(var(--e-muted-foreground))]">
                        {format(new Date(nextGuest.checkinAtLocal), "d MMM HH:mm")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-[600] text-[0.9375rem]">{nextGuest.name ?? "Guest"}</p>
                  {nextGuest.country || nextGuest.origin ? (
                    <p className="text-[hsl(var(--e-muted-foreground))]">
                      {nextGuest.country}
                      {nextGuest.origin && nextGuest.origin !== nextGuest.country ? (
                        <span className="text-[hsl(var(--e-text-faint))]"> · {nextGuest.origin}</span>
                      ) : null}
                    </p>
                  ) : null}
                  {nextGuest.guestCountLabel ? (
                    <p className="text-[hsl(var(--e-muted-foreground))]">{nextGuest.guestCountLabel}</p>
                  ) : null}
                  {nextGuest.preparationGuestCount != null ? (
                    <p className="text-[hsl(var(--e-text-faint))]">
                      Prepare for {nextGuest.preparationGuestCount}
                      {nextGuest.preparationIsFallback ? " (property max — no booking count)" : ""}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {nextGuest.phone ? (
                      <a
                        href={`tel:${nextGuest.phone}`}
                        className="inline-flex items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-2.5 py-1 font-[550] text-[hsl(var(--e-accent-portal))] hover:border-[hsl(var(--e-border-strong))]"
                      >
                        <Phone className="h-3.5 w-3.5" /> {nextGuest.phoneLabel}
                      </a>
                    ) : null}
                    {nextGuest.email ? (
                      <a href={`mailto:${nextGuest.email}`} className="text-[hsl(var(--e-muted-foreground))] hover:underline">
                        {nextGuest.email}
                      </a>
                    ) : null}
                    {nextGuest.profileUrl ? (
                      <a href={nextGuest.profileUrl} target="_blank" rel="noreferrer" className="text-[0.75rem] text-[hsl(var(--e-accent-portal))] hover:underline">
                        Guest profile
                      </a>
                    ) : null}
                  </div>
                  {nextGuest.reservationCode ? (
                    <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      Code <span className="tabular-nums">{nextGuest.reservationCode}</span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-[hsl(var(--e-muted-foreground))]">
                  No incoming booking on the feed for this turnover.
                </p>
              )}

              {/* DEPARTING booking — the reservation this job hangs off. Kept
                  because admin asked to see everything, but clearly demoted so
                  it can never be mistaken for the arriving guest again. */}
              {job.reservation ? (
                <details className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                  <summary className="cursor-pointer text-[hsl(var(--e-muted-foreground))]">
                    Departing booking{job.reservation.guestName ? ` — ${job.reservation.guestName}` : ""}
                  </summary>
                  <div className="mt-2 space-y-1">
                    <p className="tabular-nums text-[hsl(var(--e-muted-foreground))]">
                      {format(new Date(job.reservation.startDate), "d MMM yyyy")} → {format(new Date(job.reservation.endDate), "d MMM yyyy")}
                    </p>
                    {job.reservation.checkoutAtLocal ? (
                      <p className="tabular-nums text-[hsl(var(--e-muted-foreground))]">
                        Check-out {format(new Date(job.reservation.checkoutAtLocal), "d MMM HH:mm")}
                      </p>
                    ) : null}
                    {departingGuestCountLabel ? (
                      <p className="text-[hsl(var(--e-muted-foreground))]">{departingGuestCountLabel}</p>
                    ) : null}
                    {job.reservation.reservationCode ? (
                      <p className="text-[hsl(var(--e-muted-foreground))]">
                        Code <span className="tabular-nums">{job.reservation.reservationCode}</span>
                      </p>
                    ) : null}
                    {job.reservation.guestPhone ? (
                      <p><a href={`tel:${job.reservation.guestPhone}`} className="text-[hsl(var(--e-muted-foreground))] hover:underline">{job.reservation.guestPhone}</a></p>
                    ) : null}
                    {job.reservation.guestEmail ? (
                      <p><a href={`mailto:${job.reservation.guestEmail}`} className="text-[hsl(var(--e-muted-foreground))] hover:underline">{job.reservation.guestEmail}</a></p>
                    ) : null}
                    {job.reservation.summary ? (
                      <p className="text-[hsl(var(--e-text-faint))]">{job.reservation.summary}</p>
                    ) : null}
                    {job.reservation.locationText ? (
                      <p className="text-[hsl(var(--e-text-faint))]">{job.reservation.locationText}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {job.reservation.source ? <EBadge tone="neutral" soft>{job.reservation.source}</EBadge> : null}
                    </div>
                    <p className="pt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))] break-all">UID {job.reservation.uid}</p>
                  </div>
                </details>
              ) : null}
            </ECardBody>
          </ECard>
        ) : null}

        {job.notes ? (
          <ECard className="md:col-span-2">
            <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Client-facing notes</ECardTitle></ECardHeader>
            <ECardBody className="pt-0 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{job.notes}</ECardBody>
          </ECard>
        ) : null}
      </div>
      ) : null}

      {/* ── People ───────────────────────────────────────────────────────── */}
      {tab === "people" ? (
      <div className="space-y-4">
        {/* Assigned cleaners — inline dispatch */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Assigned cleaners</ECardTitle></ECardHeader>
          <ECardBody className="pt-0">
            <JobAssignPanel
              jobId={job.id}
              jobLabel={propLabel}
              jobSubLabel={`${titleCase(job.jobType)} · ${scheduledLabel}${job.startTime ? ` · ${job.startTime}` : ""}`}
              assignments={panelAssignments}
            />
          </ECardBody>
        </ECard>

        {/* Status · allocated hours · per-cleaner transport and custom payout —
            edited here rather than in a modal. */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Status &amp; per-cleaner pay</ECardTitle></ECardHeader>
          <ECardBody className="pt-0"><JobDetailManage job={manageJob} section="people" /></ECardBody>
        </ECard>
      </div>
      ) : null}

      {/* ── Schedule ─────────────────────────────────────────────────────── */}
      {tab === "schedule" ? (
      <div className="space-y-4">
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Reschedule &amp; timing</ECardTitle></ECardHeader>
          <ECardBody className="pt-0"><JobDetailManage job={manageJob} section="schedule" /></ECardBody>
        </ECard>

        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <RefreshCw className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Continuation requests
              {pendingContinuations > 0 ? <EBadge tone="warning" soft>{pendingContinuations} pending</EBadge> : null}
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <JobContinuationReviews requests={continuationRows} />
          </ECardBody>
        </ECard>

        {/* Skipping is a scheduling decision — whether this clean happens at
            all — not a destructive one, so it lives here rather than Danger. */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Skip this clean</ECardTitle></ECardHeader>
          <ECardBody className="pt-0"><JobDetailManage job={manageJob} section="skip" /></ECardBody>
        </ECard>
      </div>
      ) : null}

      {/* ── Quality ──────────────────────────────────────────────────────── */}
      {tab === "quality" ? (
      <div className="space-y-4">
        {/* QA inspection — current assignment + assign/reassign */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="flex items-center gap-2 text-[0.95rem]"><ShieldCheck className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> QA inspection</ECardTitle></ECardHeader>
          <ECardBody className="pt-0">
            <QaAssignPanel
              jobId={job.id}
              current={
                qaAssignment
                  ? {
                      id: qaAssignment.id,
                      status: String(qaAssignment.status),
                      assignedToId: qaAssignment.assignedToId,
                      assignedToName: qaAssignment.assignedTo?.name ?? qaAssignment.assignedTo?.email ?? null,
                      earlyStartReason: qaAssignment.earlyStartReason,
                    }
                  : null
              }
              inspectors={qaEligibleUsers.map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
                role: String(u.role),
              }))}
            />
          </ECardBody>
        </ECard>

      </div>
      ) : null}

      {/* ── Money ────────────────────────────────────────────────────────── */}
      {tab === "money" ? (
      <div className="space-y-4">
        {/* Money — client charge vs cleaner pay vs margin */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="flex items-center gap-2 text-[0.95rem]"><Wallet className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Money &amp; margin</ECardTitle></ECardHeader>
          <ECardBody className="space-y-3 pt-0 text-[0.8125rem]">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-2.5 py-2">
                <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Client charge</p>
                <p className="e-numeral mt-0.5 text-[1.05rem] leading-none">{clientCharge != null ? money(clientCharge) : "Rate card"}</p>
              </div>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-2.5 py-2">
                <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Cleaner pay</p>
                <p className="e-numeral mt-0.5 text-[1.05rem] leading-none">{payRows.length > 0 ? money(cleanerCost) : "—"}</p>
              </div>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-2.5 py-2">
                <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Margin</p>
                <p className={`e-numeral mt-0.5 text-[1.05rem] leading-none ${margin != null && margin < 0 ? "text-[hsl(var(--e-danger))]" : ""}`}>
                  {margin != null ? money(margin) : "—"}
                  {marginPct != null ? <span className="ml-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{marginPct}%</span> : null}
                </p>
              </div>
            </div>
            {payRows.length > 0 ? (
              <ul className="space-y-1 border-t border-[hsl(var(--e-border))] pt-2">
                {payRows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-[550]">{row.name}</span>
                      {row.isPrimary ? <span className="ml-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">(primary)</span> : null}
                    </span>
                    <span className="flex items-center gap-1.5 text-[hsl(var(--e-muted-foreground))]">
                      <span className="e-numeral">{money(row.total)}</span>
                      <EBadge tone={row.custom != null ? "aubergine" : row.estimated ? "warning" : "neutral"} soft>
                        {row.custom != null
                          ? "Custom payout"
                          : row.rate != null && payHours != null
                            ? `${money(row.rate)}/h × ${payHours}h`
                            : "Rate pending"}
                      </EBadge>
                      {row.transport > 0 ? <EBadge tone="info" soft>+{money(row.transport)} transport</EBadge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {anyEstimated ? (
              <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                Pay shown is an estimate (hours × rate); actuals settle at payroll from clocked time.
              </p>
            ) : null}
            {job.invoiceNote ? <p className="pt-1 text-[hsl(var(--e-text-faint))]">Invoice note: {job.invoiceNote}</p> : null}
          </ECardBody>
        </ECard>

        {/* Fixed price · invoice note · the canonical per-payee pay ledger. */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Billing &amp; pay ledger</ECardTitle></ECardHeader>
          <ECardBody className="pt-0"><JobDetailManage job={manageJob} section="billing" /></ECardBody>
        </ECard>
      </div>
      ) : null}

      {/* ── Quality (continued) ──────────────────────────────────────────── */}
      {tab === "quality" ? (
      <div className="space-y-4">
        {/* QA */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="flex items-center gap-2 text-[0.95rem]"><ShieldCheck className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Quality</ECardTitle></ECardHeader>
          <ECardBody className="space-y-1 pt-0 text-[0.8125rem]">
            {qa ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="e-numeral text-[1.25rem] leading-none">{Math.round(qa.score)}</span>
                  <EBadge tone={qa.passed ? "success" : "danger"} soft>{qa.passed ? "Passed" : "Failed"}</EBadge>
                  <EBadge tone="neutral" soft>{qa.kind}</EBadge>
                </div>
                {qa.notes ? <p className="pt-1 text-[hsl(var(--e-muted-foreground))]">{qa.notes}</p> : null}
                <p className="text-[hsl(var(--e-text-faint))]">{format(new Date(qa.createdAt), "d MMM yyyy")}</p>
              </>
            ) : (
              <p className="text-[hsl(var(--e-muted-foreground))]">No QA review yet.</p>
            )}
            <div className="pt-2">
              <QuickQaReview jobId={job.id} jobStatus={job.status} hasReview={!!qa} defaultScore={qa ? Math.round(qa.score) : 90} />
            </div>
          </ECardBody>
        </ECard>
      </div>
      ) : null}

      {/* ── Laundry ──────────────────────────────────────────────────────── */}
      {tab === "laundry" ? (
      <div className="space-y-4">
        {/* Laundry */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="flex items-center gap-2 text-[0.95rem]"><Shirt className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Laundry</ECardTitle></ECardHeader>
          <ECardBody className="space-y-1 pt-0 text-[0.8125rem]">
            {job.laundryTask ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <EBadge tone="info" soft>{titleCase(String(job.laundryTask.status))}</EBadge>
                  {job.laundryTask.noPickupRequired ? <EBadge tone="neutral" soft>No pickup required</EBadge> : null}
                  {job.laundryTask.supplier?.name ? (
                    <EBadge tone="neutral" soft>{job.laundryTask.supplier.name}</EBadge>
                  ) : null}
                </div>
                {/* Planned vs actual, side by side. Showing only the planned
                    dates made a task read as done when it had not happened —
                    the timing complaint in CP-9. Actuals carry the time. */}
                <dl className="pt-1 space-y-0.5 text-[hsl(var(--e-muted-foreground))]">
                  {laundryTimingRows.map((row) => (
                    <div key={row.label} className="flex flex-wrap gap-x-2">
                      <dt className="min-w-[5.5rem]">{row.label}</dt>
                      <dd className="tabular-nums">{row.planned}</dd>
                      <dd className={row.actual ? "tabular-nums text-[hsl(var(--e-text-secondary))]" : "text-[hsl(var(--e-text-faint))]"}>
                        {row.actual ? `· actual ${row.actual}` : "· not yet"}
                      </dd>
                    </div>
                  ))}
                  {job.laundryTask.confirmedAt ? (
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="min-w-[5.5rem]">Confirmed</dt>
                      <dd className="tabular-nums">{format(new Date(job.laundryTask.confirmedAt), "d MMM HH:mm")}</dd>
                    </div>
                  ) : null}
                </dl>
                {job.laundryTask.bagWeightKg != null || job.laundryTask.dropoffCostAud != null ? (
                  <p className="text-[hsl(var(--e-muted-foreground))]">
                    {job.laundryTask.bagWeightKg != null ? `${job.laundryTask.bagWeightKg} kg` : ""}
                    {job.laundryTask.bagWeightKg != null && job.laundryTask.dropoffCostAud != null ? " · " : ""}
                    {job.laundryTask.dropoffCostAud != null ? money(job.laundryTask.dropoffCostAud) : ""}
                  </p>
                ) : null}
                {job.laundryTask.flagNotes ? <p className="text-[hsl(var(--e-text-faint))]">{job.laundryTask.flagNotes}</p> : null}

                {/* Evidence photos: key handling at both ends, the drop-off
                    receipt, and whatever the cleaner attached on confirmation. */}
                {laundryImages.length > 0 ? (
                  <div className="grid gap-3 pt-2 sm:grid-cols-3">
                    {laundryImages.map((img) => (
                      <a
                        key={img.url}
                        href={img.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 hover:border-[hsl(var(--e-border-strong))]"
                      >
                        <img
                          src={img.url}
                          alt={img.label}
                          className="mb-2 h-28 w-full rounded object-cover"
                        />
                        <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{img.label}</span>
                      </a>
                    ))}
                  </div>
                ) : null}

                {job.laundryTask.confirmations.length > 0 ? (
                  <ul className="space-y-1 pt-2">
                    {job.laundryTask.confirmations.map((c) => (
                      <li key={c.id} className="text-[hsl(var(--e-muted-foreground))]">
                        {format(new Date(c.createdAt), "d MMM HH:mm")} ·{" "}
                        {c.laundryReady ? "Ready" : "Not ready"}
                        {c.bagLocation ? ` · ${c.bagLocation}` : ""}
                        {c.notes ? ` · ${c.notes}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-[hsl(var(--e-muted-foreground))]">No laundry task for this job.</p>
            )}
          </ECardBody>
        </ECard>

        {/* The submission's laundry outcome — the only place it can be
            corrected. It used to sit under "Billing" in the manage modal. */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Correct the laundry outcome</ECardTitle></ECardHeader>
          <ECardBody className="pt-0"><JobDetailManage job={manageJob} section="laundry" /></ECardBody>
        </ECard>
      </div>
      ) : null}

      {/* ── Forms & report ───────────────────────────────────────────────── */}
      {tab === "forms" ? (
      <div className="space-y-4">
        {/* Report actions — download, client visibility, share (v1 parity) */}
        <ReportActions
          jobId={job.id}
          initialClientVisible={job.report?.clientVisible !== false}
          initialSentToClient={job.report?.sentToClient ?? false}
          clientEmail={job.property?.client?.email ?? ""}
          hasSubmission={job.formSubmissions.length > 0}
          hasQaReview={Boolean(qa)}
          qaReviewId={qa?.id ?? null}
          initialQaCleanerVisible={qa?.cleanerReportVisible !== false}
        />

        {/* D4 — every document this job produced, incl. damage reports, which
            were previously reachable from nowhere on the job. */}
        <FormsQaCentre
          jobId={job.id}
          hasReport={Boolean(job.report)}
          hasQaReview={Boolean(qa)}
        />

        {/* What the cleaner sent back for each requested task. Written to
            JobTaskAttachment on completion and, until now, read by nobody. */}
        <TaskEvidence
          jobId={job.id}
          tasks={taskRows}
          includeInReport={jobMeta.includeTaskPhotosInReport !== false}
        />

        {/* Submitted job form */}
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <ClipboardList className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Submitted job form
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <SubmissionReview
              jobId={job.id}
              submissions={submissionRows}
              property={propertyRecord}
              reworkFlags={reworkFlags}
            />
          </ECardBody>
        </ECard>
      </div>
      ) : null}

      {/* ── Messages ─────────────────────────────────────────────────────── */}
      {/* #chat stays the deep-link target from the approvals "Client requests"
          queue, so that anchor keeps working alongside ?tab=messages. */}
      {tab === "messages" ? (
      <ECard id="chat">
        <ECardHeader className="pb-2">
          <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
            <MessageCircle className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Client messages
          </ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          <JobChatAdmin jobId={job.id} />
        </ECardBody>
      </ECard>
      ) : null}

      {/* ── Scope & requests ─────────────────────────────────────────────── */}
      {tab === "scope" ? (
      <div className="space-y-4">
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Notes, tags &amp; admin tasks</ECardTitle></ECardHeader>
          <ECardBody className="pt-0"><JobDetailManage job={manageJob} section="scope" /></ECardBody>
        </ECard>

        {/* Extras & scope changes — add quote-style extras anytime; the client is
            emailed the updated total automatically. */}
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <PackagePlus className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Extras &amp; scope changes
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <JobExtrasPanel jobId={job.id} fixedPrice={job.fixedPrice} />
          </ECardBody>
        </ECard>

        {/* Task requests — admin- and client-raised alike. Admin ones used to
            be filtered out entirely, so an admin could ask for something and
            never see whether it happened. */}
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <ListChecks className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Task requests
              {pendingTaskCount > 0 ? <EBadge tone="warning" soft>{pendingTaskCount} pending</EBadge> : null}
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <TaskRequestReviews jobId={job.id} tasks={taskRows} />
          </ECardBody>
        </ECard>
        {/* Continuation requests moved to the Schedule tab — they are a
            rescheduling decision, and they were previously the only place a
            reschedule could be approved while the modal owned the dates. */}
      </div>
      ) : null}

      {/* ── Activity ─────────────────────────────────────────────────────── */}
      {tab === "activity" ? (
      <div className="grid gap-4 md:grid-cols-2">
        {/* Clock records. min-w-0 lets the table's overflow-x-auto scroll
            inside the card on phones instead of widening the whole page. */}
        <ECard className="min-w-0">
          <ECardHeader className="pb-2">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <Clock className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Clock records
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {/* Clock + GPS records are admin-editable: server recomputes the
                pay-driving durationM, audit-logs before/after, notifies the
                cleaner and refreshes any generated report. */}
            <ClockRecordsEditor
              jobId={job.id}
              timeLogs={job.timeLogs.map((log) => ({
                id: log.id,
                startedAt: log.startedAt.toISOString(),
                stoppedAt: log.stoppedAt?.toISOString() ?? null,
                durationM: log.durationM,
                userName: log.user?.name ?? log.user?.email ?? "Cleaner",
              }))}
            />
            {/* Where the cleaner actually clocked in and out, against the
                property pin. The editor below shows the same numbers; the map
                is what makes an off-site clock-in obvious at a glance. Degrades
                to "open in Google Maps" links without a maps API key. */}
            {job.gpsCheckInLat != null || job.gpsCheckOutLat != null ? (
              <ClockLocationsMap
                property={{
                  lat: job.property?.latitude ?? null,
                  lng: job.property?.longitude ?? null,
                  name: job.property?.name ?? null,
                }}
                checkIn={
                  job.gpsCheckInLat != null && job.gpsCheckInLng != null
                    ? {
                        lat: job.gpsCheckInLat,
                        lng: job.gpsCheckInLng,
                        at: job.gpsCheckInAt?.toISOString() ?? null,
                        accuracy: job.gpsCheckInAccuracyM,
                      }
                    : null
                }
                checkOut={
                  job.gpsCheckOutLat != null && job.gpsCheckOutLng != null
                    ? {
                        lat: job.gpsCheckOutLat,
                        lng: job.gpsCheckOutLng,
                        at: job.gpsCheckOutAt?.toISOString() ?? null,
                      }
                    : null
                }
                distanceMeters={job.gpsDistanceMeters}
              />
            ) : null}
            <GpsRecordEditor
              jobId={job.id}
              gps={{
                checkInLat: job.gpsCheckInLat,
                checkInLng: job.gpsCheckInLng,
                checkInAt: job.gpsCheckInAt?.toISOString() ?? null,
                checkInAccuracyM: job.gpsCheckInAccuracyM,
                checkOutLat: job.gpsCheckOutLat,
                checkOutLng: job.gpsCheckOutLng,
                checkOutAt: job.gpsCheckOutAt?.toISOString() ?? null,
                distanceMeters: job.gpsDistanceMeters,
                adjusted: job.gpsCheckInAdjusted,
                reasonCode: job.gpsCheckInReasonCode,
                note: job.gpsCheckInNote,
              }}
            />
          </ECardBody>
        </ECard>

        {/* Audit trail */}
        <ECard className="min-w-0">
          <ECardHeader className="pb-2">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <History className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Audit trail
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            {auditRows.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No audit entries for this job yet.</p>
            ) : (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {auditRows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-[0.8125rem]">
                    <span className="min-w-0">
                      <span className="font-[550]">{titleCase(row.action)}</span>
                      <span className="text-[hsl(var(--e-muted-foreground))]"> · {row.entity}</span>
                      <span className="block text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                        {row.user?.name ?? row.user?.email ?? "System"}
                      </span>
                    </span>
                    <span className="text-[0.75rem] tabular-nums text-[hsl(var(--e-text-faint))]">
                      {format(new Date(row.createdAt), "dd MMM yyyy HH:mm")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ECardBody>
        </ECard>
      </div>
      ) : null}

      {tab === "activity" && hasLinkedRefs ? (
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <Link2 className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Linked records
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="grid gap-4 pt-0 md:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[0.75rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                <ShieldCheck className="h-3.5 w-3.5" /> Cases
              </p>
              {linkedCases.length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No linked cases.</p>
              ) : (
                <ul className="space-y-1.5">
                  {linkedCases.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                      <Link href={`/v2/admin/cases`} className="min-w-0 truncate font-[550] text-[hsl(var(--e-accent-portal))] hover:underline">
                        {c.title}
                      </Link>
                      <EBadge tone="neutral" soft>{titleCase(c.caseType)}</EBadge>
                      <EBadge tone={c.severity === "CRITICAL" || c.severity === "HIGH" ? "danger" : "warning"} soft>{titleCase(c.severity)}</EBadge>
                      <EBadge tone={String(c.state) === "RESOLVED" || c.status === "RESOLVED" ? "success" : "info"} soft>{titleCase(String(c.state ?? c.status))}</EBadge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[0.75rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                <Receipt className="h-3.5 w-3.5" /> Invoice lines
              </p>
              {linkedInvoiceLines.length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Not invoiced yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {linkedInvoiceLines.map((line) => (
                    <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                      <span className="min-w-0">
                        <span className="font-[550]">{line.invoice?.invoiceNumber ?? "Invoice"}</span>
                        <span className="text-[hsl(var(--e-muted-foreground))]"> · {line.description}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="e-numeral tabular-nums">{money(line.lineTotal)}</span>
                        {line.invoice?.status ? <EBadge tone="neutral" soft>{titleCase(String(line.invoice.status))}</EBadge> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      {/* ── Danger ───────────────────────────────────────────────────────── */}
      {tab === "danger" ? (
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="text-[0.95rem]">Reset or delete this job</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <JobDetailManage job={manageJob} section="danger" />
          </ECardBody>
        </ECard>
      ) : null}

    </div>
  );
}
