import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientLaundryForUser } from "@/lib/client/portal-data";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { logger } from "@/lib/logger";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { LaundryWorkspace } from "@/components/v2/client/laundry/laundry-workspace";

export const metadata = { title: "Laundry · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientLaundryPage() {
  await ensureClientModuleAccess("laundry");
  const session = await requireRole([Role.CLIENT]);
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings).catch((err) => {
    logger.error({ err, userId: session.user.id }, "Client laundry: portal context failed");
    return null;
  });
  // Never swallow a query failure silently — an empty page and a broken page
  // looked identical to the client, which is how a real fault went unnoticed.
  const tasks = await listClientLaundryForUser(session.user.id).catch((err) => {
    logger.error({ err, userId: session.user.id }, "Client laundry: task query failed");
    return [];
  });

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your homes"
        title="Laundry"
        description="Read-only laundry schedule and timeline for your properties, with today's linked cleaning jobs pinned first."
      />
      <LaundryWorkspace tasks={tasks} showLaundryImages={portal?.visibility.showLaundryImages ?? false} />
    </div>
  );
}
