import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
// Estate-native schedule: custom CSS-grid month view + 14-day agenda built on
// the same /api/jobs + /api/admin/laundry/calendar data as the legacy
// dispatch calendar. Rescheduling runs through each job's Manage hub.
import { EstateSchedule } from "@/components/v2/admin/calendar/estate-schedule";

export const metadata = { title: "Calendar · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminCalendarPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Schedule"
        description="The month at a glance — every job, colour-keyed by status, with an agenda for the fortnight ahead."
      />
      <EstateSchedule />
    </div>
  );
}
