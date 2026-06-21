import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AdminMaintenanceDetail } from "@/components/maintenance/admin-maintenance-detail";

export const dynamic = "force-dynamic";

export default async function AdminMaintenanceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <AdminMaintenanceDetail itemId={params.id} />;
}
