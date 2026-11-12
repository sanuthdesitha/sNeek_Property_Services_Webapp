import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { legacyFormsPageRedirect } from "@/lib/admin/legacy-forms-redirects";

export const dynamic = "force-dynamic";

/**
 * The classic Forms page is retired (Wave E): its Builder, Checklists and
 * Submissions tabs live in the Forms library at /v2/admin/forms. Old links,
 * including `?tab=`, open the same content there.
 */
export default async function LegacyFormsPageRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  redirect(legacyFormsPageRedirect(searchParams));
}
