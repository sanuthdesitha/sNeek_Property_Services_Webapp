import Link from "next/link";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { JobStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { ArrowLeft, MapPin, Shirt, ShieldCheck, Wallet } from "lucide-react";

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
        completedAt: true,
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
          select: { score: true, passed: true, notes: true, kind: true, createdAt: true },
        },
        laundryTask: {
          select: { status: true, pickupDate: true, dropoffDate: true, flagNotes: true },
        },
      },
    })
    .catch(() => null);
}

export default async function AdminJobDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const job = await getJob(params.id);
  if (!job) notFound();

  const qa = job.qaReviews[0] ?? null;
  const scheduledLabel = (() => {
    const parsed = new Date(job.scheduledDate);
    return Number.isNaN(parsed.getTime()) ? "Date not set" : format(parsed, "EEEE d MMMM yyyy");
  })();
  const timeLabel = job.startTime
    ? `${job.startTime}${job.dueTime ? ` – ${job.dueTime}` : ""}${job.endTime ? ` (ended ${job.endTime})` : ""}`
    : "No time set";
  const propLabel = [job.property?.name, job.property?.suburb].filter(Boolean).join(" · ") || "Property";

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
        actions={<EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge>}
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

      {job.notes ? (
        <ECard>
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Notes</ECardTitle></ECardHeader>
          <ECardBody className="pt-0 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{job.notes}</ECardBody>
        </ECard>
      ) : null}

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · read-only · live data from your workspace.</p>
    </div>
  );
}
