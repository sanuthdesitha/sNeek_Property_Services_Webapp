import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { resolveTimingBadges } from "@/lib/jobs/timing-badges";
import { sydneyDateKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateCalendar, type CalendarJob } from "@/components/v2/cleaner/estate-calendar";

export const metadata = { title: "Calendar · Estate cleaner" };
export const dynamic = "force-dynamic";

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
      return "info";
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
      return "warning";
    case "SUBMITTED":
    case "QA_REVIEW":
      return "aubergine";
    case "COMPLETED":
      return "success";
    case "INVOICED":
      return "neutral";
    default:
      return "neutral";
  }
}
function titleCase(v: string) {
  return v.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Native Estate cleaner calendar. The selected Sydney month includes all jobs
 * actively assigned to the session cleaner. The mounted EstateCalendar
 * (month grid + agenda) deep-links each entry
 * into the Estate job workspace. No v1 calendar / UI components are imported.
 */
export default async function V2CleanerCalendarPage({
  searchParams,
}: { searchParams?: { month?: string | string[] } }) {
  await ensureCleanerModuleAccess("calendar");
  const session = await requireRole([Role.CLEANER]);
  const todayKey = sydneyTodayKey();
  const requestedMonth = searchParams?.month;
  const monthKey = typeof requestedMonth === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) &&
    Number(requestedMonth.slice(0, 4)) >= 2000 && Number(requestedMonth.slice(0, 4)) <= 2100
    ? requestedMonth : todayKey.slice(0, 7);
  const [year, month] = monthKey.split("-").map(Number);
  const nextMonthKey = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;

  const jobs = await db.job
    .findMany({
      where: {
        assignments: { some: { userId: session.user.id, removedAt: null } },
        scheduledDate: { gte: sydneyDayStart(`${monthKey}-01`), lt: sydneyDayStart(`${nextMonthKey}-01`) },
      },
      select: {
        id: true,
        status: true,
        jobType: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        sameDayCheckin: true,
        sameDayCheckinTime: true,
        internalNotes: true,
        assignments: { where: { userId: session.user.id, removedAt: null }, select: { responseStatus: true } },
        property: { select: { name: true, suburb: true } },
      },
      orderBy: [{ scheduledDate: "asc" }],
    })
    .catch(() => null);

  const events: CalendarJob[] = (jobs ?? []).map((job) => ({
    id: job.id,
    dateKey: sydneyDateKey(job.scheduledDate),
    title: job.property.name,
    subtitle: [job.property.suburb, titleCase(job.jobType)].filter(Boolean).join(" · "),
    startTime: job.startTime,
    dueTime: job.dueTime,
    sameDayCheckin: job.sameDayCheckin,
    sameDayCheckinTime: job.sameDayCheckinTime,
    status: titleCase(job.status),
    rawStatus: job.status,
    pendingOffer: job.assignments.some((assignment) => assignment.responseStatus === "PENDING"),
    timingBadges: resolveTimingBadges(job.internalNotes),
    tone: statusTone(job.status),
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Schedule"
        title="Calendar"
        description="Your assigned jobs for the selected month."
      />
      {jobs === null ? (
        <div role="alert" className="space-y-2">
          <p>Unable to load your calendar. Please try again.</p>
          <a href={`/v2/cleaner/calendar?month=${monthKey}`} className="inline-block underline">Retry</a>
        </div>
      ) : (
        <EstateCalendar jobs={events} monthKey={monthKey} todayKey={todayKey} />
      )}
    </div>
  );
}
