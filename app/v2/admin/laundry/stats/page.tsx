// Laundry statistics moved into the Laundry page's Statistics tab
// (components/v2/admin/laundry/laundry-statistics.tsx, figures from
// GET /api/admin/laundry/stats). The old address keeps working: it redirects
// there and carries any other query parameters along.
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { laundryStatsRedirectTarget } from "@/lib/laundry/stats-redirect";

export const dynamic = "force-dynamic";

export default async function EstateLaundryStatsRedirect({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  redirect(laundryStatsRedirectTarget(searchParams));
}
