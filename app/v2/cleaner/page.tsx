import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEyebrow,
  EEmptyState,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { CheckCircle2, ChevronRight, Clock, MapPin } from "lucide-react";

export const metadata = { title: "Today · Estate cleaner" };
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

function isSameLocalDay(date: Date, now: Date) {
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

/**
 * This cleaner's active jobs for the next 7 days — mirrors the live cleaner
 * dashboard query (assignments scoped to the session user, removedAt null,
 * open statuses only). Scoped so a cleaner never sees another cleaner's work.
 */
async function getCleanerWeekJobs(userId: string, todayStart: Date, nextWeek: Date) {
  return db.job
    .findMany({
      where: {
        assignments: { some: { userId, removedAt: null } },
        scheduledDate: { gte: todayStart, lt: nextWeek },
        status: { notIn: ["COMPLETED", "INVOICED"] },
      },
      select: {
        id: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        property: { select: { name: true, address: true, suburb: true } },
      },
      orderBy: [
        { scheduledDate: "asc" },
        { priorityBucket: "asc" },
        { dueTime: "asc" },
        { startTime: "asc" },
      ],
    })
    .catch(() => []);
}

export default async function CleanerTodayPage() {
  const session = await requireRole([Role.CLEANER]);
  const cleanerName =
    session.user.name?.trim()?.split(" ")[0] ||
    session.user.email?.split("@")[0] ||
    "there";

  const now = toZonedTime(new Date(), TZ);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextWeek = new Date(todayStart.getTime() + 7 * 86_400_000);

  const jobs = await getCleanerWeekJobs(session.user.id, todayStart, nextWeek);

  const todayJobs = jobs.filter((j) => isSameLocalDay(toZonedTime(j.scheduledDate, TZ), now));
  const laterToday = todayJobs.slice(1);
  const nextJob = todayJobs[0] ?? jobs[0] ?? null;

  const dateLine = format(now, "EEEE · d MMMM").toUpperCase();
  const greeting = now.getHours() < 12 ? "Morning" : now.getHours() < 17 ? "Afternoon" : "Evening";
  const jobCount = todayJobs.length;

  return (
    <div className="space-y-6">
      <header className="e-rise">
        <EEyebrow>{dateLine}</EEyebrow>
        <h1 className="e-display-md mt-1">
          {greeting}, {cleanerName}.
        </h1>
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          {jobCount === 0
            ? "No jobs scheduled today — enjoy the day."
            : `${jobCount} job${jobCount === 1 ? "" : "s"} today.`}
        </p>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <EStatCard label="Today" value={String(jobCount)} />
        <EStatCard label="This week" value={String(jobs.length)} />
        <EStatCard label="Next" value={nextJob?.startTime || "—"} />
      </section>

      {/* Next job — the hero card */}
      {nextJob ? (
        <ECard variant="ceremony">
          <ECardBody className="space-y-3 pt-6">
            <div className="flex items-center justify-between">
              <EEyebrow>
                {todayJobs[0]?.id === nextJob.id ? "NEXT JOB · TODAY" : "NEXT JOB"}
              </EEyebrow>
              <EBadge tone="info" soft>
                <Clock className="h-3 w-3" />{" "}
                {nextJob.startTime ? `Due ${nextJob.startTime}` : "TBC"}
              </EBadge>
            </div>
            <p className="e-display-sm">{nextJob.property.name}</p>
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              {[nextJob.property.suburb, titleCase(nextJob.jobType)].filter(Boolean).join(" · ")}
            </p>
            <p className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {[nextJob.property.address, nextJob.property.suburb].filter(Boolean).join(", ")}
              </span>
            </p>
            <div className="pt-2">
              <Link href={`/v2/cleaner/jobs/${nextJob.id}`}>
                <EButton variant="gold" className="w-full">
                  Open job <ChevronRight className="h-4 w-4" />
                </EButton>
              </Link>
            </div>
          </ECardBody>
        </ECard>
      ) : (
        <EEmptyState
          eyebrow="All clear"
          title="Nothing scheduled"
          description="You have no jobs booked for today or the days ahead."
        />
      )}

      {/* Later today */}
      {laterToday.length > 0 ? (
        <section className="space-y-3">
          <span className="e-eyebrow">LATER TODAY</span>
          {laterToday.map((j) => (
            <Link key={j.id} href={`/v2/cleaner/jobs/${j.id}`} className="block">
              <ECard>
                <ECardBody className="flex items-center gap-3 pt-6">
                  <div className="flex h-11 w-11 flex-col items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))]">
                    <span className="text-[0.8125rem] font-semibold tabular-nums">
                      {j.startTime || "—"}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.875rem] font-[550]">{j.property.name}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {titleCase(j.jobType)}
                    </p>
                  </div>
                  <EBadge tone={statusTone(j.status)} soft>
                    {titleCase(j.status)}
                  </EBadge>
                </ECardBody>
              </ECard>
            </Link>
          ))}
        </section>
      ) : null}

      {/* End of day (signature moment) */}
      {jobCount > 0 ? (
        <ECard className="border-dashed">
          <ECardBody className="flex items-center gap-3 pt-6 text-[hsl(var(--e-muted-foreground))]">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-[0.8125rem]">
              Finish {jobCount === 1 ? "it" : `all ${jobCount}`} and the day closes with a flourish.
            </p>
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
