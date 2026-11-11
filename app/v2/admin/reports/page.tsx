import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { opsLevelAllows } from "@/lib/rbac/ops-catalog";
import { getAppSettings } from "@/lib/settings";
import { insightsAccessFor } from "@/lib/insights/access";
import { InsightsPage } from "@/components/v2/admin/insights/insights-page";

export const metadata = { title: "Insights · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Insights: business, property, client, cleaner and time figures for a
 * period, and the Client report PDFs manager as its last tab. The route and
 * its guard are unchanged: ADMIN and OPS_MANAGER (operations managers through
 * the `reports` feature). Financial figures follow `finance` on the server
 * (lib/insights/access); report write controls follow `reports` at manage
 * level, since the write endpoints refuse a read-only pack.
 * Old manager links (?q=, ?propertyId=, ?visibility=, ?sort=newest…) open the
 * PDFs tab with their filters (lib/insights/url-state).
 */
export default async function V2AdminReportsPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const levels = await getOpsAccess(session.user);
  const settings = await getAppSettings().catch(() => null);
  return (
    <InsightsPage
      context={{
        access: insightsAccessFor(levels),
        canManageReports: !levels || opsLevelAllows(levels.reports, "PATCH"),
        timeZone: settings?.timezone || "Australia/Sydney",
      }}
    />
  );
}
