import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { ProfileSettings } from "@/components/profile/profile-settings";

export const dynamic = "force-dynamic";

export default async function MaintenanceSettingsPage() {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  return <ProfileSettings />;
}
