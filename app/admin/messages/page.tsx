import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AdminMessagesWorkspace } from "@/components/admin/admin-messages-workspace";

export default async function AdminMessagesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <AdminMessagesWorkspace />;
}
