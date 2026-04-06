import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientJobsForUser } from "@/lib/client/portal-data";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { ClientJobsWorkspace } from "@/components/client/client-jobs-workspace";

export default async function ClientJobsPage() {
  await ensureClientModuleAccess("jobs");
  const session = await requireRole([Role.CLIENT]);
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings);
  const jobs = await listClientJobsForUser(session.user.id);

  return (
    <ClientJobsWorkspace
      jobs={jobs}
      showCleanerNames={portal.visibility.showCleanerNames}
      showClientTaskRequests={portal.visibility.showClientTaskRequests}
      showLaundryUpdates={portal.visibility.showLaundryUpdates}
    />
  );
}
