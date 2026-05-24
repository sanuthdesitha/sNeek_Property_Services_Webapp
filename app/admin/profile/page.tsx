import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { ProfileSettings } from "@/components/profile/profile-settings";
import { DisplayPreferencesSection } from "@/components/profile/display-preferences-section";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";

export default async function AdminProfilePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const session = await getServerSession(authOptions);
  const userPrefs = session?.user?.id
    ? await db.user.findUnique({
        where: { id: session.user.id },
        select: { uiDensity: true, themePreference: true },
      })
    : null;

  return (
    <div className="space-y-6">
      <ProfileSettings />
      <DisplayPreferencesSection
        initialDensity={userPrefs?.uiDensity ?? undefined}
        initialTheme={userPrefs?.themePreference ?? undefined}
      />
    </div>
  );
}
