import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { PortalCalendar, type PortalCalendarEvent } from "@/components/calendar/portal-calendar";

export const metadata = { title: "Calendar · Estate cleaner" };
export const dynamic = "force-dynamic";

// Theme tokens so events read in light + dark. Mirrors the legacy cleaner
// calendar colour map exactly.
function tokenColor(variant: string, alpha?: number) {
  return alpha === undefined ? `hsl(var(--${variant}))` : `hsl(var(--${variant}) / ${alpha})`;
}

const STATUS_COLORS: Record<string, { border: string; bg: string; label: string }> = {
  UNASSIGNED: { border: tokenColor("warning"), bg: tokenColor("warning", 0.18), label: "UNASSIGNED" },
  OFFERED: { border: tokenColor("warning"), bg: tokenColor("warning", 0.18), label: "AWAITING CONFIRMATION" },
  ASSIGNED: { border: tokenColor("primary"), bg: tokenColor("primary", 0.18), label: "ASSIGNED" },
  IN_PROGRESS: { border: tokenColor("info"), bg: tokenColor("info", 0.18), label: "IN PROGRESS" },
  PAUSED: { border: tokenColor("warning"), bg: tokenColor("warning", 0.18), label: "PAUSED" },
  WAITING_CONTINUATION_APPROVAL: { border: tokenColor("danger"), bg: tokenColor("danger", 0.18), label: "WAITING CONTINUATION APPROVAL" },
  SUBMITTED: { border: tokenColor("accent"), bg: tokenColor("accent", 0.18), label: "SUBMITTED" },
  QA_REVIEW: { border: tokenColor("accent"), bg: tokenColor("accent", 0.18), label: "QA REVIEW" },
  COMPLETED: { border: tokenColor("success"), bg: tokenColor("success", 0.18), label: "COMPLETED" },
  INVOICED: { border: tokenColor("muted-foreground"), bg: tokenColor("muted"), label: "INVOICED" },
};

/**
 * Estate wrapper for the cleaner job calendar. Same module gate + query as the
 * legacy `app/cleaner/calendar` route (jobs assigned to the session cleaner,
 * removedAt null). Events deep-link into the Estate job detail (/v2/cleaner/jobs).
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
        endTime: true,
        dueTime: true,
        assignments: {
          where: { userId: session.user.id, removedAt: null },
          select: { responseStatus: true },
          take: 1,
        },
        property: { select: { name: true, suburb: true } },
      },
      orderBy: [{ scheduledDate: "asc" }],
      take: 400,
    })
    .catch(() => []);

  const events: PortalCalendarEvent[] = jobs.map((job) => {
    const dateKey = job.scheduledDate.toISOString().slice(0, 10);
    const colors = STATUS_COLORS[job.status] ?? STATUS_COLORS.ASSIGNED;
    return {
      id: job.id,
      title: job.property.name,
      start: job.startTime ? `${dateKey}T${job.startTime}:00` : `${dateKey}T08:00:00`,
      end: job.endTime
        ? `${dateKey}T${job.endTime}:00`
        : job.dueTime
          ? `${dateKey}T${job.dueTime}:00`
          : undefined,
      backgroundColor: colors.bg,
      borderColor: colors.border,
      textColor: "hsl(var(--foreground))",
      extendedProps: {
        badgeLabel: colors.label,
        subtitle: job.jobType.replace(/_/g, " "),
        meta: [job.property.suburb, job.startTime, job.dueTime].filter(Boolean).join(" | "),
        href: `/v2/cleaner/jobs/${job.id}`,
        assignmentResponseStatus: job.assignments[0]?.responseStatus ?? null,
      },
    };
  });

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Schedule"
        title="Calendar"
        description="Your assigned jobs by month, week, or day."
      />
      <PortalCalendar
        title="My Job Calendar"
        description="See your assigned jobs by month, week, or day and tap any entry on mobile to preview the job details."
        events={events}
        legendItems={Object.values(STATUS_COLORS).map((item) => ({ label: item.label.replace(/_/g, " "), color: item.border }))}
        emptyMessage="No assigned jobs available on your calendar."
        viewPreferenceKey="sneek_cleaner_calendar_view_v1"
      />
    </div>
  );
}
