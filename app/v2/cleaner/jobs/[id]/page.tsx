import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
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
import { ArrowLeft, Clock, MapPin, CalendarDays } from "lucide-react";

export const metadata = { title: "Job · Estate cleaner" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function statusTone(status: string): Tone {
  switch (status) {
    case "UNASSIGNED":
    case "OFFERED":
      return "warning";
    case "ASSIGNED":
    case "EN_ROUTE":
      return "primary";
    case "IN_PROGRESS":
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
      return "info";
    case "SUBMITTED":
      return "warning";
    case "QA_REVIEW":
      return "aubergine";
    case "COMPLETED":
    case "INVOICED":
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

/**
 * A single job the session cleaner is assigned to — read-only detail view.
 * Scoped exactly like the live cleaner pages (assignments.some.userId,
 * removedAt null) so a cleaner can never open a job that isn't theirs; a
 * non-matching id returns null → notFound().
 */
async function getCleanerJob(userId: string, jobId: string) {
  return db.job
    .findFirst({
      where: {
        id: jobId,
        assignments: { some: { userId, removedAt: null } },
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        notes: true,
        internalNotes: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        estimatedHours: true,
        property: {
          select: {
            name: true,
            address: true,
            suburb: true,
            state: true,
            postcode: true,
            bedrooms: true,
            bathrooms: true,
          },
        },
      },
    })
    .catch(() => null);
}

export default async function CleanerJobDetailPage({ params }: { params: { id: string } }) {
  const session = await requireRole([Role.CLEANER]);
  const job = await getCleanerJob(session.user.id, params.id);
  if (!job) notFound();

  const meta = parseJobInternalNotes(job.internalNotes);
  const cleanerNotes = meta.internalNoteText?.trim();
  const tags = meta.tags ?? [];
  const scheduled = toZonedTime(job.scheduledDate, TZ);
  const addressLine = [job.property.address, job.property.suburb, job.property.state, job.property.postcode]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      <Link
        href="/v2/cleaner/jobs"
        className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All jobs
      </Link>

      <EPageHeader
        eyebrow={job.jobNumber || "Job"}
        title={job.property.name}
        description={titleCase(job.jobType)}
        actions={<EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge>}
      />

      <section className="grid gap-3 sm:grid-cols-2">
        <ECard>
          <ECardBody className="space-y-2 pt-6">
            <div className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              <CalendarDays className="h-4 w-4" /> When
            </div>
            <p className="text-[0.9375rem] font-[550]">{format(scheduled, "EEEE d MMMM yyyy")}</p>
            <p className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              <Clock className="h-3.5 w-3.5" />
              {job.startTime || "TBC"}
              {job.dueTime ? ` – ${job.dueTime}` : ""}
              {job.estimatedHours ? ` · ${job.estimatedHours}h est.` : ""}
            </p>
          </ECardBody>
        </ECard>

        <ECard>
          <ECardBody className="space-y-2 pt-6">
            <div className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              <MapPin className="h-4 w-4" /> Where
            </div>
            <p className="text-[0.9375rem] font-[550]">{job.property.name}</p>
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{addressLine}</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {job.property.bedrooms} bd · {job.property.bathrooms} ba
            </p>
          </ECardBody>
        </ECard>
      </section>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <EBadge key={tag} tone="info" soft>{tag}</EBadge>
          ))}
        </div>
      ) : null}

      {job.notes?.trim() ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Job notes</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              {job.notes.trim()}
            </p>
          </ECardBody>
        </ECard>
      ) : null}

      {cleanerNotes ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Cleaner notes</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              {cleanerNotes}
            </p>
          </ECardBody>
        </ECard>
      ) : null}

      <div>
        <Link href={`/cleaner/jobs/${job.id}`}>
          <EButton variant="gold">Open full job workspace</EButton>
        </Link>
      </div>
    </div>
  );
}
