import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { MaintenanceSettings } from "@/components/v2/maintenance/maintenance-settings";

export const metadata = { title: "Settings · Estate maintenance" };
export const dynamic = "force-dynamic";

// Estate-native maintenance worker settings — contact, notifications, appearance,
// password, and two-step verification against the same /api/me/* + /api/auth/2fa
// + /api/notifications/preferences endpoints the v1 ProfileSettings used.
export default async function MaintenanceSettingsPage() {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const user = await db.user
    .findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        phone: true,
        address: true,
        suburb: true,
        state: true,
        postcode: true,
        uiDensity: true,
        themePreference: true,
        profileEditingEnabled: true,
      } as any,
    })
    .catch(() => null);
  if (!user) redirect("/login");

  const editingEnabled = (user as any).profileEditingEnabled !== false;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Contact details, notifications, appearance and security."
      />
      <MaintenanceSettings
        user={user as any}
        editingEnabled={editingEnabled}
        initialDensity={(user as any).uiDensity ?? undefined}
        initialTheme={(user as any).themePreference ?? undefined}
      />
    </div>
  );
}
