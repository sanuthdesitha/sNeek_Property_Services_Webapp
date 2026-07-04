import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { PortalCalendar, type PortalCalendarEvent } from "@/components/calendar/portal-calendar";

export const metadata = { title: "Calendar · Estate laundry" };
export const dynamic = "force-dynamic";

// Theme tokens so events stay readable in both light and dark mode.
function tokenColor(variant: string, alpha?: number) {
  return alpha === undefined ? `hsl(var(--${variant}))` : `hsl(var(--${variant}) / ${alpha})`;
}

const LAUNDRY_COLORS: Record<string, { border: string; bg: string; label: string }> = {
  PENDING: { border: tokenColor("warning"), bg: tokenColor("warning", 0.18), label: "PENDING" },
  CONFIRMED: { border: tokenColor("primary"), bg: tokenColor("primary", 0.18), label: "CONFIRMED" },
  PICKED_UP: { border: tokenColor("info"), bg: tokenColor("info", 0.18), label: "PICKED UP" },
  DROPPED: { border: tokenColor("success"), bg: tokenColor("success", 0.18), label: "DROPPED" },
  FLAGGED: { border: tokenColor("danger"), bg: tokenColor("danger", 0.18), label: "FLAGGED" },
};

// Mirrors app/laundry/calendar: same LaundryTask query + settings-driven times.
export default async function LaundryCalendarPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);

  const tasks = await db.laundryTask
    .findMany({
      include: {
        property: { select: { name: true, suburb: true } },
        job: { select: { jobType: true } },
      },
      orderBy: [{ pickupDate: "asc" }],
      take: 500,
    })
    .catch(() => [] as any[]);

  const defaultPickupTime = settings?.laundryOperations?.defaultPickupTime || "09:00";
  const defaultDropoffTime = settings?.laundryOperations?.defaultDropoffTime || "16:00";

  const events: PortalCalendarEvent[] = tasks.flatMap((task) => {
    const colors = LAUNDRY_COLORS[task.status] ?? LAUNDRY_COLORS.CONFIRMED;
    const propertyLabel = task.property?.name ?? "Property";
    const jobType = (task.job?.jobType ?? "").replace(/_/g, " ");
    const pickupDate = task.pickupDate.toISOString().slice(0, 10);
    const dropoffDate = task.dropoffDate.toISOString().slice(0, 10);

    return [
      {
        id: `${task.id}-pickup`,
        title: `${propertyLabel} pickup`,
        start: `${pickupDate}T${defaultPickupTime}:00`,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        textColor: "hsl(var(--foreground))",
        extendedProps: {
          badgeLabel: task.status.replace(/_/g, " "),
          subtitle: `Pickup | ${jobType}`,
          meta: task.property?.suburb || undefined,
        },
      },
      {
        id: `${task.id}-dropoff`,
        title: `${propertyLabel} drop-off`,
        start: `${dropoffDate}T${defaultDropoffTime}:00`,
        backgroundColor: tokenColor("info", 0.18),
        borderColor: tokenColor("info"),
        textColor: "hsl(var(--foreground))",
        extendedProps: {
          badgeLabel: task.status.replace(/_/g, " "),
          subtitle: `Return | ${jobType}`,
          meta: task.property?.suburb || undefined,
        },
      },
    ];
  });

  return (
    <PortalCalendar
      title="Laundry Calendar"
      description="See pickups and returns across all laundry tasks. Tap any event on mobile to preview the booking details."
      events={events}
      legendItems={Object.values(LAUNDRY_COLORS).map((item) => ({ label: item.label.replace(/_/g, " "), color: item.border }))}
      emptyMessage="No laundry tasks scheduled right now."
    />
  );
}
