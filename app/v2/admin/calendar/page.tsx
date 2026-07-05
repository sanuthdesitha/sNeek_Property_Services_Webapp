import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
// Estate-native schedule: custom CSS-grid month view + 14-day agenda built on
// the same /api/jobs + /api/admin/laundry/calendar data as the legacy
// dispatch calendar. Drag-reschedule remains in the classic calendar.
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
        actions={
          <Link
            href="/admin/calendar"
            className="text-[0.8125rem] font-[550] text-[hsl(var(--e-gold-ink))] underline-offset-4 hover:underline"
          >
            Open dispatch calendar (classic) →
          </Link>
        }
      />
      <EstateSchedule />
    </div>
  );
}
