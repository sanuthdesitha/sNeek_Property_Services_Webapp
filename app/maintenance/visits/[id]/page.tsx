import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { WorkerVisitClient } from "@/components/maintenance/worker-visit-client";

export const dynamic = "force-dynamic";

export default async function MaintenanceVisitPage({ params }: { params: { id: string } }) {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  return <WorkerVisitClient itemId={params.id} />;
}
