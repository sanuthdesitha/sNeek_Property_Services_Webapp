import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { legacyFormEditRedirect } from "@/lib/admin/legacy-forms-redirects";

export const dynamic = "force-dynamic";

/**
 * The classic form builder was retired; the builder is
 * /v2/admin/forms/[id]/edit (drafts, versions, publish checks). Same admission
 * as before (ADMIN), then the same form opens there.
 */
export default async function LegacyFormEditRedirect({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireRole([Role.ADMIN]);
  redirect(legacyFormEditRedirect(params.id, searchParams));
}
