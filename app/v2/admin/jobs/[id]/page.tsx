import Link from "next/link";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { JobStatus, JobTaskSource, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
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
  ListChecks,
  MapPin,
  RefreshCw,
  Shirt,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { QuickQaReview } from "@/components/v2/admin/jobs/quick-qa-review";
import {
  JobContinuationReviews,
  JobDetailManage,
  TaskRequestReviews,
  type JobContinuationRow,
  type TaskRequestRow,
} from "@/components/v2/admin/jobs/job-detail-reviews";
import { SubmissionReview, type SubmissionRow } from "@/components/v2/admin/jobs/submission-review";

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
            user: { select: { name: true, email: true } },
          },
        },
        qaReviews: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { score: true, passed: true, notes: true, kind: true, createdAt: true, flags: true },
        },
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
  const [continuations, auditRows, fullProperty] = await Promise.all([
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

  const manageJob = {
    id: job.id,
    jobNumber: job.jobNumber,
    status: job.status,
    scheduledDate: job.scheduledDate.toISOString(),
    startTime: job.startTime,
    dueTime: job.dueTime,
    fixedPrice: job.fixedPrice,
    invoiceNote: job.invoiceNote,
    internalNotes: job.internalNotes,
    cleanSkipStatus: job.cleanSkipStatus,
    property: { name: job.property?.name ?? null },
  };

  const pendingTaskCount = taskRows.filter((t) => t.approvalStatus === "PENDING_APPROVAL").length;
  const pendingContinuations = continuationRows.filter((r) => r.status === "PENDING").length;

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

        {/* Assigned cleaners */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Assigned cleaners</ECardTitle></ECardHeader>
          <ECardBody className="pt-0">
            {job.assignments.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No cleaners assigned yet.</p>
            ) : (
              <ul className="space-y-2">
                {job.assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    {a.isPrimary ? <EBadge tone="primary" soft>Primary</EBadge> : null}
                    <span className="font-[550]">{a.user?.name ?? a.user?.email ?? "Cleaner"}</span>
                    <EBadge tone={a.responseStatus === "PENDING" ? "warning" : "neutral"} soft>{titleCase(String(a.responseStatus))}</EBadge>
                  </li>
                ))}
              </ul>
            )}
          </ECardBody>
        </ECard>

        {/* Money */}
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="flex items-center gap-2 text-[0.95rem]"><Wallet className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Money</ECardTitle></ECardHeader>
          <ECardBody className="space-y-1 pt-0 text-[0.8125rem]">
            <p className="text-[hsl(var(--e-muted-foreground))]">Client charge</p>
            <p className="e-numeral text-[1.25rem] leading-none">{job.fixedPrice != null ? money(job.fixedPrice) : "Rate card"}</p>
            {job.invoiceNote ? <p className="pt-1 text-[hsl(var(--e-text-faint))]">{job.invoiceNote}</p> : null}
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
      </div>

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

      {job.notes ? (
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Notes</ECardTitle></ECardHeader>
          <ECardBody className="pt-0 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{job.notes}</ECardBody>
        </ECard>
      ) : null}

    </div>
  );
}
