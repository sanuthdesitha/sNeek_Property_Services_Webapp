import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EAlert, EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { SafeguardsScreen } from "@/components/v2/admin/notifications/safeguards/safeguards-screen";
import { buildSafeguardsOverview } from "@/lib/notifications/safeguards/overview";
import { manageRefusal } from "@/lib/notifications/safeguards/route-support";
import type { SafeguardsResponse } from "@/lib/notifications/safeguards/overview-types";

export const metadata = { title: "Sending safeguards · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Notifications › Sending safeguards. ADMIN, and OPS_MANAGER with the
 * notifications (communications) pack (the shared middleware checks the
 * pack). Changes are ADMIN only, never while impersonating (decided by the
 * server routes; the screen only hides what the routes would refuse).
 */
export default async function SendingSafeguardsPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const timeZone = (await getAppSettings().catch(() => null))?.timezone || "Australia/Sydney";
  const readOnlyReason = manageRefusal(session);
  const overview = await buildSafeguardsOverview().catch(() => null);
  const initial: SafeguardsResponse | null = overview ? { ...overview, canManage: readOnlyReason === null, readOnlyReason } : null;
  return (
    <div className="min-w-0 space-y-6">
      <EPageHeader
        eyebrow="Notifications"
        title="Sending safeguards"
        description="Limits on how often one person can be emailed, texted or pushed, automatic pauses when something loops, and the emergency stop."
        actions={<EButton asChild variant="ghost" className="min-h-[44px]"><Link href="/v2/admin/notifications">All notifications</Link></EButton>}
      />
      {initial ? (
        <SafeguardsScreen initial={initial} timeZone={timeZone} />
      ) : (
        <EAlert tone="danger" title="The safeguards could not be read">Nothing is shown rather than a false "all clear". Reload the page to try again.</EAlert>
      )}
    </div>
  );
}
