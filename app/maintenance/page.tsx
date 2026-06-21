import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { WorkerJobsList } from "@/components/maintenance/worker-jobs-list";

export const dynamic = "force-dynamic";

export default async function MaintenanceJobsPage() {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  return <WorkerJobsList scope="active" />;
}
