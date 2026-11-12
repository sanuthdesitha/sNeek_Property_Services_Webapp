import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { GrowthHub } from "@/components/v2/admin/growth/growth-hub";
import { loadGrowthSummary } from "@/lib/growth/summary";

export const metadata = { title: "Growth · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Growth (2026-11 redesign, board "Growth"): is new business coming in?
 * Leads and quotes, marketing, website and blog, and hiring with real counts,
 * each block opening its full workspace (where every function stays). Blocks
 * the viewer may not open are left out.
 */
export default async function AdminGrowthPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  const timezone = settings?.timezone || "Australia/Sydney";
  const summary = await loadGrowthSummary(
    { id: session.user.id, role: String(session.user.role), heldRoles: session.user.heldRoles?.map(String) },
    timezone,
  );
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Money"
        title="Growth"
        description="Win clients and hire cleaners: leads, campaigns, the website and hiring in one place · this month so far."
        actions={
          <>
            {summary.website ? (
              <EButton asChild variant="outline" size="sm"><Link href="/v2/admin/website/blog">Write blog post</Link></EButton>
            ) : null}
            {summary.campaigns ? (
              <EButton asChild size="sm"><Link href="/v2/admin/marketing">New campaign</Link></EButton>
            ) : null}
          </>
        }
      />
      <GrowthHub summary={summary} timezone={timezone} />
    </div>
  );
}
