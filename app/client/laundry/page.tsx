import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientLaundryForUser } from "@/lib/client/portal-data";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { ClientLaundryWorkspace } from "@/components/client/client-laundry-workspace";

export default async function ClientLaundryPage() {
  await ensureClientModuleAccess("laundry");
  const session = await requireRole([Role.CLIENT]);
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings);
  const tasks = await listClientLaundryForUser(session.user.id);

  return (
    <ClientLaundryWorkspace
      tasks={tasks}
      showLaundryImages={portal.visibility.showLaundryImages}
    />
  );
}
