import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientJobsForUser } from "@/lib/client/portal-data";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { ClientJobsBoard } from "@/components/v2/client/jobs-board";
import { EButton, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Jobs · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientJobsPage() {
  await ensureClientModuleAccess("jobs");
  const session = await requireRole([Role.CLIENT]);

  const settings = await getAppSettings().catch(() => null);
  const portal = settings
    ? await getClientPortalContext(session.user.id, settings).catch(() => null)
    : await getClientPortalContext(session.user.id).catch(() => null);
  const jobs = await listClientJobsForUser(session.user.id).catch(() => []);

  const visibility = portal?.visibility;

  return (
    <div className="space-y-8">
      <EPageHeader
        eyebrow="SCHEDULING"
        title="Jobs"
        description="Upcoming services first, with quick filters, task requests, and linked laundry updates."
        actions={
          <>
            <EButton asChild variant="outline" size="sm"><Link href="/v2/client/calendar">Calendar</Link></EButton>
            <EButton asChild variant="gold" size="sm"><Link href="/client/booking">Book a clean</Link></EButton>
          </>
        }
      />

      {jobs.length === 0 ? (
        <EEmptyState
          eyebrow="All quiet"
          title="No jobs on record"
          description="Scheduled services across your properties will appear here."
          action={
            <EButton asChild variant="gold" size="sm"><Link href="/client/booking">Book a clean</Link></EButton>
          }
        />
      ) : (
        <ClientJobsBoard
          jobs={jobs}
          showCleanerNames={visibility?.showCleanerNames ?? false}
          showClientTaskRequests={visibility?.showClientTaskRequests ?? false}
          showLaundryUpdates={visibility?.showLaundryUpdates ?? false}
        />
      )}
    </div>
  );
}
