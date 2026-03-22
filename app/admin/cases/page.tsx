import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AdminCasesWorkspace } from "@/components/cases/admin-cases-workspace";

export default async function AdminCasesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <AdminCasesWorkspace />;
}

