import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientJobsForUser } from "@/lib/client/portal-data";
import { ClientServicesAgenda, type ServiceRow } from "@/components/v2/client/services-agenda";
import { EButton, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";
import { CalendarPlus, MessageSquare } from "lucide-react";

export const metadata = { title: "Services · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientServicesPage() {
  const session = await requireRole([Role.CLIENT]);

  // Cleaner names are gated by the same client-visibility setting the jobs page
  // honours — without this the agenda leaked names when the setting was off.
  const settings = await getAppSettings().catch(() => null);
  const portal = settings
    ? await getClientPortalContext(session.user.id, settings).catch(() => null)
    : await getClientPortalContext(session.user.id).catch(() => null);
  const showCleanerNames = portal?.visibility?.showCleanerNames ?? false;

  const jobs = await listClientJobsForUser(session.user.id).catch(() => []);

  // Lean, serialisable rows — the agenda does all grouping/filtering client-side.
  const rows: ServiceRow[] = jobs.map((job) => ({
    id: job.id,
    jobType: job.jobType,
    status: job.status,
    scheduledDate: job.scheduledDate.toISOString(),
    startTime: job.startTime ?? null,
    property: { id: job.property.id, name: job.property.name },
    cleanerName: showCleanerNames ? job.assignments[0]?.user?.name ?? null : null,
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your bookings"
        title="Services"
        description="Every clean, day by day — upcoming and done, in one agenda."
        actions={
          <>
            <EButton asChild variant="gold" size="sm"><Link href="/v2/client/booking">
                <CalendarPlus className="h-3.5 w-3.5" /> Book a clean
              </Link></EButton>
            <EButton asChild variant="outline" size="sm"><Link href="/v2/client/messages">
                <MessageSquare className="h-3.5 w-3.5" /> Message ops
              </Link></EButton>
          </>
        }
      />

      {rows.length === 0 ? (
        <EEmptyState
          eyebrow="All quiet"
          title="No services yet"
          description="Scheduled services across your properties will appear here."
          action={
            <EButton asChild variant="gold" size="sm"><Link href="/v2/client/booking">Book a clean</Link></EButton>
          }
        />
      ) : (
        <ClientServicesAgenda jobs={rows} nowIso={new Date().toISOString()} />
      )}
    </div>
  );
}
