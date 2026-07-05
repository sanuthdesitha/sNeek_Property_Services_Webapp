import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EstateMaintenanceDetail } from "@/components/v2/admin/maintenance/maintenance-detail";

export const metadata = { title: "Maintenance item · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateMaintenanceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <EstateMaintenanceDetail itemId={params.id} />;
}
