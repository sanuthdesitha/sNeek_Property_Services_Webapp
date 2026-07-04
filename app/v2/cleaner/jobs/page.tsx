import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  ECard,
  ECardBody,
  EPageHeader,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { ChevronRight, Clock } from "lucide-react";

export const metadata = { title: "Jobs · Estate cleaner" };
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
 * The cleaner's upcoming / assigned jobs — mirrors the live cleaner jobs page
 * query (assignments scoped to the session user, removedAt null). Scoped so a
 * cleaner only ever lists their own jobs.
 */
async function getCleanerJobs(userId: string) {
  return db.job
    .findMany({
      where: {
        assignments: { some: { userId, removedAt: null } },
        status: { notIn: ["COMPLETED", "INVOICED"] },
      },
      select: {
        id: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        property: { select: { name: true, suburb: true, address: true } },
      },
      orderBy: [
        { scheduledDate: "asc" },
        { priorityBucket: "asc" },
        { dueTime: "asc" },
        { startTime: "asc" },
      ],
      take: 100,
    })
    .catch(() => []);
}

export default async function CleanerJobsPage() {
  const session = await requireRole([Role.CLEANER]);
  const jobs = await getCleanerJobs(session.user.id);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your schedule"
        title="Jobs"
        description={
          jobs.length === 0
            ? "Nothing assigned right now."
            : `${jobs.length} upcoming assignment${jobs.length === 1 ? "" : "s"}.`
        }
      />

      {jobs.length === 0 ? (
        <EEmptyState
          eyebrow="Clear"
          title="No upcoming jobs"
          description="When a job is assigned to you it will appear here."
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <Link key={j.id} href={`/v2/cleaner/jobs/${j.id}`} className="block">
              <ECard>
                <ECardBody className="flex items-center gap-3 pt-6">
                  <div className="flex h-11 w-11 flex-col items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))]">
                    <span className="text-[0.625rem] font-medium uppercase tracking-[0.04em] text-[hsl(var(--e-muted-foreground))]">
                      {format(toZonedTime(j.scheduledDate, TZ), "MMM")}
                    </span>
                    <span className="text-[0.9375rem] font-semibold leading-none tabular-nums">
                      {format(toZonedTime(j.scheduledDate, TZ), "d")}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.875rem] font-[550]">{j.property.name}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <span>{titleCase(j.jobType)}</span>
                      {j.startTime ? (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {j.startTime}
                          {j.dueTime ? `–${j.dueTime}` : ""}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <EBadge tone={statusTone(j.status)} soft>
                    {titleCase(j.status)}
                  </EBadge>
                  <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                </ECardBody>
              </ECard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
