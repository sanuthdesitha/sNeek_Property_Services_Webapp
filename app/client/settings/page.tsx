import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { ProfileSettings } from "@/components/profile/profile-settings";

export default async function ClientSettingsPage() {
  await requireRole([Role.CLIENT]);
  return <ProfileSettings />;
}
