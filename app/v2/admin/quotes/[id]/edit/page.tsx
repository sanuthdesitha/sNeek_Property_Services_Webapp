import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * The separate Edit quote page became the quote full page (2026-11): the
 * builder sections are edited in place there. Old links keep working.
 */
export default async function V2EditQuoteRedirect({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  redirect(`/v2/admin/quotes/${encodeURIComponent(params.id)}`);
}
