import Link from "next/link";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { JobStatus, JobTaskSource, QaAssignmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import {
  ArrowLeft,
  ClipboardList,
  Clock,
  History,
  Link2,
  ListChecks,
  MapPin,
  PackagePlus,
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
import { ReportActions } from "@/components/v2/admin/jobs/report-actions";
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

function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
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
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            suburb: true,
            client: { select: { id: true, name: true, email: true } },
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
          select: { score: true, passed: true, notes: true, kind: true, createdAt: true, flags: true },
        },
        report: { select: { clientVisible: true, sentToClient: true } },
        laundryTask: {
          select: { status: true, pickupDate: true, dropoffDate: true, flagNotes: true },
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
          where: { source: JobTaskSource.CLIENT },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            description: true,
            approvalStatus: true,
            executionStatus: true,
            requiresPhoto: true,
            requiresNote: true,
            createdAt: true,
            requestedBy: { select: { name: true, email: true } },
            attachments: {
              where: { kind: "REQUEST_REFERENCE" },
              orderBy: { createdAt: "asc" },
              select: { id: true, url: true, s3Key: true, label: true, mediaType: true },
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

export default async function AdminJobDetailPage({ params }: { params: { id: string } }) {
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
      attachments: task.attachments.map((att) => ({
        id: att.id,
        url: att.url,
        s3Key: att.s3Key,
        label: att.label,
        mediaType: String(att.mediaType),
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
            {showReminderButton ? <JobReminderButton jobId={job.id} statusLabel={titleCase(job.status)} /> : null}
            <JobDetailManage job={manageJob} />
          </div>
        }
      />

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
              <p className="pt-1 text-[hsl(var(--e-text-secondary))]">
                Client:{" "}
                <Link href={`/v2/admin/clients/${job.property.client.id}`} className="font-medium text-[hsl(var(--e-accent-portal))] hover:underline">
                  {job.property.client.name}
                </Link>
              </p>
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
          </ECardBody>
        </ECard>

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

        {/* Laundry */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="flex items-center gap-2 text-[0.95rem]"><Shirt className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Laundry</ECardTitle></ECardHeader>
          <ECardBody className="space-y-1 pt-0 text-[0.8125rem]">
            {job.laundryTask ? (
              <>
                <EBadge tone="info" soft>{titleCase(String(job.laundryTask.status))}</EBadge>
                <p className="pt-1 text-[hsl(var(--e-muted-foreground))]">
                  Pickup {format(new Date(job.laundryTask.pickupDate), "d MMM")} · Dropoff {format(new Date(job.laundryTask.dropoffDate), "d MMM")}
                </p>
                {job.laundryTask.flagNotes ? <p className="text-[hsl(var(--e-text-faint))]">{job.laundryTask.flagNotes}</p> : null}
              </>
            ) : (
              <p className="text-[hsl(var(--e-muted-foreground))]">No laundry task for this job.</p>
            )}
          </ECardBody>
        </ECard>

        {/* Report actions — download, client visibility, share (v1 parity) */}
        <ReportActions
          jobId={job.id}
          initialClientVisible={job.report?.clientVisible !== false}
          initialSentToClient={job.report?.sentToClient ?? false}
          clientEmail={job.property?.client?.email ?? ""}
          hasSubmission={job.formSubmissions.length > 0}
          hasQaReview={Boolean(qa)}
        />
      </div>

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

      {/* ── Review surfaces ─────────────────────────────────────────────── */}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Client task requests */}
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <ListChecks className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Client task requests
              {pendingTaskCount > 0 ? <EBadge tone="warning" soft>{pendingTaskCount} pending</EBadge> : null}
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <TaskRequestReviews jobId={job.id} tasks={taskRows} />
          </ECardBody>
        </ECard>

        {/* Continuation / reschedule decisions */}
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
      </div>

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

      <div className="grid gap-4 md:grid-cols-2">
        {/* Clock records */}
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <Clock className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Clock records
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {job.timeLogs.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No time logs recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]">
                  <thead>
                    <tr className="border-b border-[hsl(var(--e-border))] text-left text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                      <th className="py-2 pr-3">Cleaner</th>
                      <th className="py-2 pr-3">Start</th>
                      <th className="py-2 pr-3">Stop</th>
                      <th className="py-2 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[hsl(var(--e-border))]">
                    {job.timeLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 pr-3 font-[550]">{log.user?.name ?? log.user?.email ?? "Cleaner"}</td>
                        <td className="py-2 pr-3 tabular-nums">{format(new Date(log.startedAt), "dd MMM HH:mm")}</td>
                        <td className="py-2 pr-3 tabular-nums">{log.stoppedAt ? format(new Date(log.stoppedAt), "dd MMM HH:mm") : "—"}</td>
                        <td className="py-2 text-right tabular-nums">
                          {log.durationM != null ? minutesLabel(log.durationM) : <EBadge tone="info" soft>Active</EBadge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {job.gpsCheckInLat != null && job.gpsCheckInLng != null ? (
              <div className="space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                <p>
                  Clock-in GPS:{" "}
                  <a className="text-[hsl(var(--e-accent-portal))] hover:underline" href={mapsLink(job.gpsCheckInLat, job.gpsCheckInLng)} target="_blank" rel="noreferrer">
                    {job.gpsCheckInLat.toFixed(5)}, {job.gpsCheckInLng.toFixed(5)}
                  </a>
                  {job.gpsCheckInAt ? ` · ${format(new Date(job.gpsCheckInAt), "dd MMM HH:mm")}` : ""}
                  {job.gpsCheckInAccuracyM != null ? ` · ±${Math.round(job.gpsCheckInAccuracyM)}m` : ""}
                </p>
                {job.gpsCheckOutLat != null && job.gpsCheckOutLng != null ? (
                  <p>
                    Clock-out GPS:{" "}
                    <a className="text-[hsl(var(--e-accent-portal))] hover:underline" href={mapsLink(job.gpsCheckOutLat, job.gpsCheckOutLng)} target="_blank" rel="noreferrer">
                      {job.gpsCheckOutLat.toFixed(5)}, {job.gpsCheckOutLng.toFixed(5)}
                    </a>
                    {job.gpsCheckOutAt ? ` · ${format(new Date(job.gpsCheckOutAt), "dd MMM HH:mm")}` : ""}
                  </p>
                ) : null}
                {job.gpsDistanceMeters != null ? (
                  <p>Distance from property at clock-in: {job.gpsDistanceMeters}m</p>
                ) : null}
              </div>
            ) : null}
          </ECardBody>
        </ECard>

        {/* Audit trail */}
        <ECard>
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

      {hasLinkedRefs ? (
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

      {job.notes ? (
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Notes</ECardTitle></ECardHeader>
          <ECardBody className="pt-0 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{job.notes}</ECardBody>
        </ECard>
      ) : null}

    </div>
  );
}
