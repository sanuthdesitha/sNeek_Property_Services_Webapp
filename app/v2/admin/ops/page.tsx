import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { canActAs } from "@/lib/auth/roles";
import { getAppSettings } from "@/lib/settings";
import { requireCommandViewer } from "@/lib/dashboard/command-access";
import { buildWorkQueue } from "@/lib/dashboard/work-queue";
import { liveAttentionLinks } from "@/lib/ops/live-attention";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { LiveFeedProvider } from "@/components/v2/admin/ops/live-feed-provider";
import { LIVE_VIEWS, LiveOpsWorkspace, type LiveView } from "@/components/v2/admin/ops/live-ops-workspace";
import type { OpsMapProperty } from "@/components/v2/admin/ops/estate-ops-map";

export const metadata = { title: "Live ops · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Live ops: what is happening right now. Exceptions (late, off site with the
 * clock running, continuation requests, not started) with their actions,
 * on-site progress and the live map, all from one feed. The planning lists
 * that used to live here (dispatch blockers, QA and stale cases, new leads,
 * laundry exceptions, expiring documents, immediate attention) are rows in
 * Command's work queue; the "Also needs attention" row links there with counts.
 *
 * Same roles as before (ADMIN, OPS_MANAGER); "today" is the Sydney calendar day.
 * "Notify client" and "Pause clock" are shown to administrators only.
 */
export default async function V2AdminOpsPage({ searchParams }: { searchParams?: { view?: string | string[] } }) {
  const viewer = await requireCommandViewer();
  // Notify client and Pause clock are ADMIN only (their routes), and never
  // while impersonating: the target's restrictions apply.
  const session = await requireSession();
  const canAdminister = !session.impersonation && canActAs((session.user.heldRoles ?? [session.user.role]) as Role[], [Role.ADMIN]);
  const settings = await getAppSettings().catch(() => null);
  const timeZone = settings?.timezone || "Australia/Sydney";
  const rawView = Array.isArray(searchParams?.view) ? searchParams?.view[0] : searchParams?.view;
  const initialView: LiveView = LIVE_VIEWS.includes(rawView as LiveView) ? (rawView as LiveView) : "exceptions";

  const [geocoded, queue] = await Promise.all([
    db.property
      .findMany({
        where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
        select: { id: true, name: true, suburb: true, latitude: true, longitude: true },
      })
      .catch(() => []),
    buildWorkQueue(viewer, { timeZone }).catch(() => null),
  ]);
  const properties: OpsMapProperty[] = geocoded
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p) => ({ name: p.name, suburb: p.suburb, lat: p.latitude as number, lng: p.longitude as number }));

  return (
    <LiveFeedProvider>
      <LiveOpsWorkspace
        properties={properties}
        attention={queue ? liveAttentionLinks(queue) : null}
        initialView={initialView}
        todayKey={sydneyTodayKey()}
        timeZone={timeZone}
        readOnly={viewer.readOnly}
        canAdminister={canAdminister}
      />
    </LiveFeedProvider>
  );
}
