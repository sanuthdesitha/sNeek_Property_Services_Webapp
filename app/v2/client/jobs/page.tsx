import Link from "next/link";
import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientJobsForUser } from "@/lib/client/portal-data";
import { ClientJobsBoard } from "@/components/v2/client/jobs-board";
import { EButton, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Jobs · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientJobsPage() {
  const portalCtx = await requireClientPortalPage({ module: "jobs" });
  // Shim: downstream code reads session.user.id — for a VA that is THEIR id,
  // and the VA-aware resolvers scope it to their team's client and properties.
  const session = { user: { id: portalCtx.userId, name: portalCtx.userName } };

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
            <EButton asChild variant="gold" size="sm"><Link href="/v2/client/booking">Book a clean</Link></EButton>
          </>
        }
      />

      {jobs.length === 0 ? (
        <EEmptyState
          eyebrow="All quiet"
          title="No jobs on record"
          description="Scheduled services across your properties will appear here."
          action={
            <EButton asChild variant="gold" size="sm"><Link href="/v2/client/booking">Book a clean</Link></EButton>
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
