import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { PortalCalendar, type PortalCalendarEvent } from "@/components/calendar/portal-calendar";

// Use theme tokens so events stay readable in both light and dark mode.
function tokenColor(variant: string, alpha?: number) {
  return alpha === undefined
    ? `hsl(var(--${variant}))`
    : `hsl(var(--${variant}) / ${alpha})`;
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

export default async function ClientCalendarPage() {
  await ensureClientModuleAccess("calendar");
  const session = await requireRole([Role.CLIENT]);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { clientId: true },
  });

  const jobs = user?.clientId
    ? await db.job.findMany({
        where: {
          property: { clientId: user.clientId },
        },
        select: {
          id: true,
          status: true,
          jobType: true,
          scheduledDate: true,
          startTime: true,
          endTime: true,
          dueTime: true,
          report: { select: { id: true } },
          property: { select: { name: true, suburb: true } },
        },
        orderBy: [{ scheduledDate: "asc" }],
        take: 500,
      })
    : [];

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
        badgeLabel: job.status.replace(/_/g, " "),
        subtitle: job.jobType.replace(/_/g, " "),
        meta: [job.property.suburb, job.startTime, job.dueTime, job.report ? "Report ready" : undefined]
          .filter(Boolean)
          .join(" | "),
      },
    };
  });

  return (
    <PortalCalendar
      title="Property Service Calendar"
      description="Track scheduled and completed services across your properties. On phone, tap any entry to see the job details popup."
      events={events}
      legendItems={Object.values(STATUS_COLORS).map((item) => ({ label: item.label.replace(/_/g, " "), color: item.border }))}
      emptyMessage="No jobs available for your properties right now."
    />
  );
}
