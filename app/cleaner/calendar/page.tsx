import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { PortalCalendar, type PortalCalendarEvent } from "@/components/calendar/portal-calendar";

const STATUS_COLORS: Record<string, { border: string; bg: string }> = {
  UNASSIGNED: { border: "#f59e0b", bg: "rgba(245,158,11,0.14)" },
  ASSIGNED: { border: "#2563eb", bg: "rgba(37,99,235,0.14)" },
  IN_PROGRESS: { border: "#0f766e", bg: "rgba(15,118,110,0.14)" },
  SUBMITTED: { border: "#4f46e5", bg: "rgba(79,70,229,0.14)" },
  QA_REVIEW: { border: "#ea580c", bg: "rgba(234,88,12,0.14)" },
  COMPLETED: { border: "#16a34a", bg: "rgba(22,163,74,0.14)" },
  INVOICED: { border: "#64748b", bg: "rgba(100,116,139,0.14)" },
};

export default async function CleanerCalendarPage() {
  await ensureCleanerModuleAccess("calendar");
  const session = await requireRole([Role.CLEANER]);

  const jobs = await db.job.findMany({
    where: {
      assignments: { some: { userId: session.user.id } },
    },
    select: {
      id: true,
      status: true,
      jobType: true,
      scheduledDate: true,
      startTime: true,
      endTime: true,
      dueTime: true,
      property: { select: { name: true, suburb: true } },
    },
    orderBy: [{ scheduledDate: "asc" }],
    take: 400,
  });

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
      textColor: "#0f172a",
      extendedProps: {
        badgeLabel: job.status.replace(/_/g, " "),
        subtitle: job.jobType.replace(/_/g, " "),
        meta: [job.property.suburb, job.startTime, job.dueTime].filter(Boolean).join(" • "),
        href: `/cleaner/jobs/${job.id}`,
      },
    };
  });

  return (
    <PortalCalendar
      title="My Job Calendar"
      description="See your assigned jobs by month, week, or day and open a job directly from the schedule."
      events={events}
      emptyMessage="No assigned jobs available on your calendar."
    />
  );
}
