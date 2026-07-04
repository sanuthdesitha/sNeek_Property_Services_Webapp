import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ProfileSettings } from "@/components/profile/profile-settings";
import { EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Settings · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientSettingsPage() {
  await requireRole([Role.CLIENT]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage your account preferences and security."
      />
      <ProfileSettings />
    </div>
  );
}
