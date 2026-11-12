// A case's own address. Damage/maintenance notifications have always linked
// to /v2/admin/cases/<id>, which had no page (404). It opens the case in the
// inbox (`?open=<id>`).
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function V2AdminCaseRedirect({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const id = /^[A-Za-z0-9_-]{1,128}$/.test(params.id) ? params.id : "";
  redirect(id ? `/v2/admin/cases?open=${encodeURIComponent(id)}` : "/v2/admin/cases");
}
