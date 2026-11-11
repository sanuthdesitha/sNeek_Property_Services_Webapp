import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { formsTabRedirect } from "@/lib/admin/forms-redirects";

export const dynamic = "force-dynamic";

/**
 * Form statistics are the "Results and stats" tab of /v2/admin/forms.
 * `templateId` and `weeks` are carried across, so old links open the same view.
 */
export default async function LegacyFormStatsRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  redirect(formsTabRedirect("stats", searchParams));
}
