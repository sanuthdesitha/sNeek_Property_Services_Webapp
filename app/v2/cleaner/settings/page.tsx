import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ProfileSettings } from "@/components/profile/profile-settings";

export const metadata = { title: "Settings · Estate cleaner" };
export const dynamic = "force-dynamic";

export default async function CleanerSettingsPage() {
  await requireRole([Role.CLEANER]);

  // Reuse the exact live account settings surface (password, notifications,
  // display preferences). It owns its own data + mutations client-side — no new
  // API surface, same behaviour as /cleaner/settings.
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Account" title="Settings" description="Manage your account, security and preferences." />
      <ProfileSettings />
    </div>
  );
}
