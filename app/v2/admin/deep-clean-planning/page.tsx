import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { DeepCleanProposalQueue } from "@/components/v2/admin/properties/property-deep-clean-planning";
export const metadata = { title: "Deep-clean scheduling · Estate admin" };
export const dynamic = "force-dynamic";
export default async function DeepCleanPlanningPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <DeepCleanProposalQueue />;
}
