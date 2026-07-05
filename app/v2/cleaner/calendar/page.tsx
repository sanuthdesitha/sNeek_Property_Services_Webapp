import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
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
 * Native Estate cleaner calendar. Same module gate + query as the legacy
 * `app/cleaner/calendar` route (jobs assigned to the session cleaner, removedAt
 * null). The mounted EstateCalendar (month grid + agenda) deep-links each entry
 * into the Estate job workspace. No v1 calendar / UI components are imported.
 */
export default async function V2CleanerCalendarPage() {
  await ensureCleanerModuleAccess("calendar");
  const session = await requireRole([Role.CLEANER]);

  const jobs = await db.job
    .findMany({
      where: { assignments: { some: { userId: session.user.id, removedAt: null } } },
      select: {
        id: true,
        status: true,
        jobType: true,
        scheduledDate: true,
        startTime: true,
        property: { select: { name: true, suburb: true } },
      },
      orderBy: [{ scheduledDate: "asc" }],
      take: 400,
    })
    .catch(() => []);

  const events: CalendarJob[] = jobs.map((job) => ({
    id: job.id,
    dateKey: job.scheduledDate.toISOString().slice(0, 10),
    title: job.property.name,
    subtitle: [job.property.suburb, titleCase(job.jobType)].filter(Boolean).join(" · "),
    startTime: job.startTime,
    status: titleCase(job.status),
    tone: statusTone(job.status),
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Schedule"
        title="Calendar"
        description="Your assigned jobs by month, or as an upcoming agenda."
      />
      <EstateCalendar jobs={events} />
    </div>
  );
}
