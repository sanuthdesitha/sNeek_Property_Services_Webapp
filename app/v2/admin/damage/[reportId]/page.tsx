import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { DamageInvestigation } from "@/components/v2/damage/damage-investigation";

export const metadata = { title: "Damage report · Estate admin" };
export const dynamic = "force-dynamic";

// D2 — admin investigation. Cost editing and the release-to-client control live
// here; the same component renders the client variant with those branches off.
export default async function V2AdminDamageReportPage({
  params,
}: {
  params: { reportId: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <DamageInvestigation reportId={params.reportId} audience="ADMIN" />;
}
