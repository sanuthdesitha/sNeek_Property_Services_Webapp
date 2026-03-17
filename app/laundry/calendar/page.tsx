import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { ensureLaundryModuleAccess } from "@/lib/portal-access";
import { getAppSettings } from "@/lib/settings";
import { Role } from "@prisma/client";
import { PortalCalendar, type PortalCalendarEvent } from "@/components/calendar/portal-calendar";

const LAUNDRY_COLORS: Record<string, { border: string; bg: string }> = {
  PENDING: { border: "#f59e0b", bg: "rgba(245,158,11,0.14)" },
  CONFIRMED: { border: "#2563eb", bg: "rgba(37,99,235,0.14)" },
  PICKED_UP: { border: "#7c3aed", bg: "rgba(124,58,237,0.14)" },
  DROPPED: { border: "#16a34a", bg: "rgba(22,163,74,0.14)" },
  FLAGGED: { border: "#dc2626", bg: "rgba(220,38,38,0.14)" },
};

export default async function LaundryCalendarPage() {
  await ensureLaundryModuleAccess("calendar");
  await requireRole([Role.LAUNDRY]);
  const settings = await getAppSettings();

  const tasks = await db.laundryTask.findMany({
    include: {
      property: { select: { name: true, suburb: true } },
      job: { select: { jobType: true } },
    },
    orderBy: [{ pickupDate: "asc" }],
    take: 500,
  });

  const events: PortalCalendarEvent[] = tasks.flatMap((task) => {
    const colors = LAUNDRY_COLORS[task.status] ?? LAUNDRY_COLORS.CONFIRMED;
    const propertyLabel = task.property.name;
    const jobType = task.job.jobType.replace(/_/g, " ");
    const pickupDate = task.pickupDate.toISOString().slice(0, 10);
    const dropoffDate = task.dropoffDate.toISOString().slice(0, 10);
    const pickupTime = settings.laundryOperations.defaultPickupTime || "09:00";
    const dropoffTime = settings.laundryOperations.defaultDropoffTime || "16:00";

    return [
      {
        id: `${task.id}-pickup`,
        title: `${propertyLabel} pickup`,
        start: `${pickupDate}T${pickupTime}:00`,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        textColor: "#0f172a",
        extendedProps: {
          badgeLabel: task.status.replace(/_/g, " "),
          subtitle: `Pickup • ${jobType}`,
          meta: task.property.suburb || undefined,
        },
      },
      {
        id: `${task.id}-dropoff`,
        title: `${propertyLabel} drop-off`,
        start: `${dropoffDate}T${dropoffTime}:00`,
        backgroundColor: "rgba(14,165,233,0.12)",
        borderColor: "#0ea5e9",
        textColor: "#0f172a",
        extendedProps: {
          badgeLabel: task.status.replace(/_/g, " "),
          subtitle: `Return • ${jobType}`,
          meta: task.property.suburb || undefined,
        },
      },
    ];
  });

  return (
    <PortalCalendar
      title="Laundry Calendar"
      description="See pickups and returns across all laundry tasks in month, week, or day view."
      events={events}
      emptyMessage="No laundry tasks scheduled right now."
    />
  );
}
