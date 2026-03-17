import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { ProfileSettings } from "@/components/profile/profile-settings";

export default async function AdminProfilePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <ProfileSettings />;
}
