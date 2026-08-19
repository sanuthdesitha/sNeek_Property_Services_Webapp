import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { DamageInvestigation } from "@/components/v2/damage/damage-investigation";

export const metadata = { title: "Damage report" };
export const dynamic = "force-dynamic";

// D2 — the client variant. Whether this client may see THIS report is decided
// by the API (released, own property, not a draft), not by the page: a role
// check alone would let one client open another's report id.
export default async function V2ClientDamageReportPage({
  params,
}: {
  params: { reportId: string };
}) {
  // "damage" is a grantable permission and the damage API already honours it;
  // the page guard did not, so a granted VA still crashed on the way in.
  await requireClientPortalPage({ permission: "damage" });
  return <DamageInvestigation reportId={params.reportId} audience="CLIENT" />;
}
