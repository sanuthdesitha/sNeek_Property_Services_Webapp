import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { UsersManager } from "@/components/admin/users-manager";

export default async function AdminUsersPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <UsersManager canManage={session.user.role === Role.ADMIN} />;
}
