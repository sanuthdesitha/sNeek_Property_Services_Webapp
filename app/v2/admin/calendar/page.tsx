import { requireJobsViewsContext } from "@/lib/jobs/views-context";
// Estate calendar: week by cleaner (or property), day by hour, month and
// agenda, loading only the visible range from /api/admin/calendar. Moves go
// through a read-only server check, a confirmation, and the existing
// reschedule and assign endpoints. The job peek panel is the Jobs page's.
import { CalendarWorkspace } from "@/components/v2/admin/calendar/calendar-workspace";

export const metadata = { title: "Calendar · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminCalendarPage() {
  // Same roles as before (ADMIN, OPS_MANAGER); a read-only impersonation cannot move or assign.
  const identity = await requireJobsViewsContext();
  return <CalendarWorkspace key={identity.context} readOnly={identity.readOnly} />;
}
