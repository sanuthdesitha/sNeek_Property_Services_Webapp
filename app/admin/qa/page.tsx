import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AdminQaTemplatesClient } from "@/components/admin/admin-qa-templates-client";

export default async function AdminQaPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <AdminQaTemplatesClient />;
}
