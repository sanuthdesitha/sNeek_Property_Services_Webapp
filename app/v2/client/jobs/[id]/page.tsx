import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getClientPortalContext } from "@/lib/client/portal";
import { formatCurrency } from "@/lib/utils";
import { googleMapsSearchUrl } from "@/lib/maps/google-maps-url";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EThread,
} from "@/components/v2/ui/primitives";
import { JobSkipAction } from "@/components/v2/client/job-skip-action";
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  Clock,
  Download,
  FileText,
  MapPin,
  Navigation,
  Shirt,
  Star,
  User,
  Wallet,
} from "lucide-react";

export const metadata = { title: "Job · Estate client" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

const STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  OFFERED: "Offered",
  ASSIGNED: "Assigned",
  EN_ROUTE: "On the way",
  IN_PROGRESS: "In progress",
  PAUSED: "Paused",
  WAITING_CONTINUATION_APPROVAL: "Paused",
  SUBMITTED: "Submitted",
  QA_REVIEW: "Under review",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
};

function statusTone(status: string): Tone {
  switch (status) {
    case "UNASSIGNED":
    case "OFFERED":
    case "SUBMITTED":
      return "warning";
    case "ASSIGNED":
    case "EN_ROUTE":
      return "primary";
    case "IN_PROGRESS":
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
      return "info";
    case "QA_REVIEW":
      return "aubergine";
    case "COMPLETED":
    case "INVOICED":
      return "success";
    default:
      return "neutral";
  }
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getScopedJob(id: string, clientId: string) {
  return db.job
    .findFirst({
      where: { id, property: { clientId } },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        notes: true,
        actualHours: true,
        estimatedHours: true,
        cleanSkipStatus: true,
        cleanSkipReason: true,
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            suburb: true,
            state: true,
            postcode: true,
          },
        },
        assignments: {
          where: { removedAt: null },
          select: {
            isPrimary: true,
            user: { select: { id: true, name: true, phone: true } },
          },
        },
        laundryTask: {
          select: {
            id: true,
            status: true,
            pickupDate: true,
            dropoffDate: true,
            pickedUpAt: true,
            droppedAt: true,
            noPickupRequired: true,
          },
        },
        invoiceLines: {
          select: {
            id: true,
            description: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
            invoice: { select: { invoiceNumber: true, status: true } },
          },
        },
        report: {
          select: {
            id: true,
            pdfUrl: true,
            sentAt: true,
            clientVisible: true,
            generatedAt: true,
          },
        },
        satisfactionRating: { select: { score: true, comment: true } },
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            action: true,
            createdAt: true,
            user: { select: { name: true } },
          },
        },
      },
    })
    .catch(() => null);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[0.875rem]">
      <span className="text-[hsl(var(--e-muted-foreground))]">{label}</span>
      <span className="font-medium text-[hsl(var(--e-foreground))]">{value}</span>
    </div>
  );
}

export default async function ClientJobDetailPage({ params }: { params: { id: string } }) {
  const session = await requireRole([Role.CLIENT]);
  const portal = await getClientPortalContext(session.user.id).catch(() => null);
  const clientId = portal?.clientId;
  if (!clientId) notFound();

  const job = await getScopedJob(params.id, clientId);
  if (!job) notFound();

  const scheduled = toZonedTime(job.scheduledDate, TZ);
  const primary = job.assignments.find((a) => a.isPrimary) ?? job.assignments[0];
  const cleaner = primary?.user ?? null;
  const totalCharged = job.invoiceLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const skipStatus = job.cleanSkipStatus ?? "NONE";
  const canSkip =
    !["COMPLETED", "INVOICED"].includes(job.status) &&
    (skipStatus === "NONE" || skipStatus === "DECLINED" || skipStatus === "REQUESTED");
  const showReportTab = job.report?.clientVisible;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/v2/client/jobs" className="inline-block">
          <EButton variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="h-4 w-4" /> Jobs
          </EButton>
        </Link>
      </div>

      <EPageHeader
        eyebrow={`SCHEDULING${job.jobNumber ? ` · #${job.jobNumber}` : ""}`}
        title={job.property.name}
        description={`${titleCase(job.jobType)} · ${format(scheduled, "EEEE d MMMM yyyy")}${
          job.startTime ? ` · ${job.startTime}` : ""
        }`}
        actions={
          <>
            <EBadge tone={statusTone(job.status)} soft>
              {STATUS_LABELS[job.status] ?? titleCase(job.status)}
            </EBadge>
            {job.status === "EN_ROUTE" ? (
              <Link href={`/client/jobs/${job.id}`}>
                <EButton variant="gold" size="sm">
                  <Navigation className="h-3.5 w-3.5" /> Track live
                </EButton>
              </Link>
            ) : null}
          </>
        }
      />

      {/* Skip-clean state */}
      {skipStatus === "SKIPPED" ? (
        <ECard variant="ceremony">
          <ECardBody className="pt-6">
            <p className="text-[0.9375rem] font-semibold">Skipped — no clean</p>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              This turnover has been marked as skipped and will not be cleaned.
              {job.cleanSkipReason ? ` Reason: ${job.cleanSkipReason}` : ""}
            </p>
          </ECardBody>
        </ECard>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {skipStatus === "REQUESTED" ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Skip request pending admin review.
            </p>
          ) : skipStatus === "DECLINED" ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              A previous skip request was declined — this clean will go ahead as scheduled.
            </p>
          ) : (
            <span />
          )}
          {canSkip ? <JobSkipAction jobId={job.id} skipStatus={skipStatus} /> : null}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Property */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2 text-[1rem]">
              <MapPin className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Property
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-1 text-[0.875rem]">
            <p className="font-medium">{job.property.name}</p>
            <p className="text-[hsl(var(--e-muted-foreground))]">{job.property.address}</p>
            <p className="text-[hsl(var(--e-muted-foreground))]">
              {job.property.suburb} {job.property.state} {job.property.postcode}
            </p>
            <a
              href={googleMapsSearchUrl(job.property)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-accent-portal))] hover:underline"
            >
              <MapPin className="h-3 w-3" /> View on map
            </a>
          </ECardBody>
        </ECard>

        {/* Schedule */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2 text-[1rem]">
              <Calendar className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Schedule
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-2">
            <Row label="Date" value={format(scheduled, "EEE d MMM yyyy")} />
            {job.startTime ? <Row label="Start time" value={job.startTime} /> : null}
            {job.dueTime ? <Row label="Due by" value={job.dueTime} /> : null}
            {job.estimatedHours ? <Row label="Est. duration" value={`${job.estimatedHours}h`} /> : null}
            {job.actualHours ? <Row label="Actual duration" value={`${job.actualHours}h`} /> : null}
          </ECardBody>
        </ECard>

        {/* Cleaner */}
        {cleaner ? (
          <ECard>
            <ECardHeader>
              <ECardTitle className="flex items-center gap-2 text-[1rem]">
                <User className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Cleaner
              </ECardTitle>
            </ECardHeader>
            <ECardBody className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[0.875rem] font-bold text-[hsl(var(--e-accent-portal))]">
                  {cleaner.name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div>
                  <p className="text-[0.875rem] font-medium">{cleaner.name}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Assigned cleaner</p>
                </div>
              </div>
              {cleaner.phone ? (
                <a href={`tel:${cleaner.phone}`}>
                  <EButton variant="outline" size="sm">Call</EButton>
                </a>
              ) : null}
            </ECardBody>
          </ECard>
        ) : null}

        {/* Service */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2 text-[1rem]">
              <Briefcase className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Service
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-2 text-[0.875rem]">
            <p className="font-medium">{titleCase(job.jobType)}</p>
            {job.notes ? (
              <p className="leading-6 text-[hsl(var(--e-muted-foreground))]">{job.notes}</p>
            ) : null}
          </ECardBody>
        </ECard>
      </div>

      {/* Laundry */}
      {job.laundryTask ? (
        <ECard>
          <ECardHeader className="flex-row items-center justify-between">
            <ECardTitle className="flex items-center gap-2 text-[1rem]">
              <Shirt className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Laundry
            </ECardTitle>
            <EBadge tone="neutral" soft>{titleCase(job.laundryTask.status)}</EBadge>
          </ECardHeader>
          <ECardBody className="space-y-2 text-[0.875rem]">
            {job.laundryTask.noPickupRequired ? (
              <p className="text-[hsl(var(--e-muted-foreground))]">No laundry pickup required for this job.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {job.laundryTask.pickupDate ? (
                  <Row label="Pickup date" value={format(new Date(job.laundryTask.pickupDate), "d MMM yyyy")} />
                ) : null}
                {job.laundryTask.dropoffDate ? (
                  <Row label="Return date" value={format(new Date(job.laundryTask.dropoffDate), "d MMM yyyy")} />
                ) : null}
                {job.laundryTask.pickedUpAt ? (
                  <Row label="Picked up" value={format(new Date(job.laundryTask.pickedUpAt), "d MMM HH:mm")} />
                ) : null}
                {job.laundryTask.droppedAt ? (
                  <Row label="Returned" value={format(new Date(job.laundryTask.droppedAt), "d MMM HH:mm")} />
                ) : null}
              </div>
            )}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Costs */}
      {job.invoiceLines.length > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2 text-[1rem]">
              <Wallet className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Cost breakdown
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-2">
            {job.invoiceLines.map((line, i) => (
              <div key={line.id}>
                {i > 0 ? <EThread className="my-1" /> : null}
                <div className="flex items-start justify-between gap-3 py-1.5 text-[0.875rem]">
                  <div className="min-w-0">
                    <p className="font-medium">{line.description ?? "Service charge"}</p>
                    {line.quantity > 1 ? (
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {line.quantity} × {formatCurrency(line.unitPrice)}
                      </p>
                    ) : null}
                    {line.invoice ? (
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        Invoice #{line.invoice.invoiceNumber} · {line.invoice.status}
                      </p>
                    ) : null}
                  </div>
                  <span className="font-semibold tabular-nums text-[hsl(var(--e-foreground))]">
                    {formatCurrency(line.lineTotal)}
                  </span>
                </div>
              </div>
            ))}
            <EThread className="my-1" />
            <div className="flex items-center justify-between py-1.5 text-[0.875rem] font-semibold">
              <span>Total charged</span>
              <span className="tabular-nums text-[hsl(var(--e-foreground))]">{formatCurrency(totalCharged)}</span>
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Rating */}
      {job.satisfactionRating ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2 text-[1rem]">
              <Star className="h-4 w-4 text-[hsl(var(--e-gold))]" /> Your rating
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-2 text-[0.875rem]">
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  className={
                    i < job.satisfactionRating!.score
                      ? "text-[hsl(var(--e-gold))]"
                      : "text-[hsl(var(--e-text-faint))]"
                  }
                >
                  ★
                </span>
              ))}
              <span className="ml-1 text-[hsl(var(--e-muted-foreground))]">
                {job.satisfactionRating.score}/5
              </span>
            </div>
            {job.satisfactionRating.comment ? (
              <p className="text-[hsl(var(--e-muted-foreground))]">{job.satisfactionRating.comment}</p>
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Report */}
      {showReportTab ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2 text-[1rem]">
              <FileText className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Cleaning report
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.875rem] font-medium">Job report</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {job.report?.generatedAt
                  ? `Generated ${format(new Date(job.report.generatedAt), "d MMM yyyy")}`
                  : "Report available"}
                {job.report?.sentAt ? ` · Sent ${format(new Date(job.report.sentAt), "d MMM")}` : ""}
              </p>
            </div>
            {job.report?.pdfUrl ? (
              <a href={job.report.pdfUrl} target="_blank" rel="noopener noreferrer">
                <EButton variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5" /> Download PDF
                </EButton>
              </a>
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Timeline */}
      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2 text-[1rem]">
            <Clock className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Activity timeline
          </ECardTitle>
        </ECardHeader>
        <ECardBody>
          {job.auditLogs.length === 0 ? (
            <p className="py-4 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No activity recorded yet.
            </p>
          ) : (
            <div className="space-y-3">
              {job.auditLogs.map((log) => (
                <div key={log.id} className="flex gap-3 text-[0.875rem]">
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--e-accent-portal))]" />
                  <div className="min-w-0">
                    <p className="font-medium">{titleCase(log.action)}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {format(new Date(log.createdAt), "d MMM yyyy HH:mm")}
                      {log.user ? ` · ${log.user.name}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
