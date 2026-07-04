import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ProfileSettings } from "@/components/profile/profile-settings";
import { EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Settings · Estate maintenance" };
export const dynamic = "force-dynamic";

// Mirrors app/maintenance/settings: reuses the ProfileSettings client component.
export default async function MaintenanceSettingsPage() {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Notifications, security and account preferences."
      />
      <ProfileSettings />
    </div>
  );
}
