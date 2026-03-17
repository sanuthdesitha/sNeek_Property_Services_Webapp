import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { ProfileSettings } from "@/components/profile/profile-settings";

export default async function LaundrySettingsPage() {
  await requireRole([Role.LAUNDRY]);
  return <ProfileSettings />;
}
