import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { LaundryCalendar } from "@/components/v2/laundry/laundry-calendar";

export const metadata = { title: "Calendar · Estate laundry" };
export const dynamic = "force-dynamic";

// Native Estate laundry schedule — a month grid + day agenda of pickups and
// returns, reading the SAME /api/laundry/week feed the laundry board uses.
// No FullCalendar / v1 UI imports.
export default async function LaundryCalendarPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Schedule"
        title="Laundry calendar"
        description="Pickups and returns across every laundry task. Tap a day to see its agenda; tap a task to open tracking."
      />
      <LaundryCalendar />
    </div>
  );
}
