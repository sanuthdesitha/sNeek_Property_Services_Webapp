import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateProfile } from "@/components/v2/laundry/estate-profile";

export const metadata = { title: "Profile · Estate admin" };
export const dynamic = "force-dynamic";

// Estate-native admin profile & security. Mirrors app/admin/profile: same user
// query + endpoints (/api/me/profile, /api/me/preferences, /api/me/password,
// /api/auth/2fa/settings) via the shared EstateProfile kit. No banking for admins.
export default async function AdminProfilePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
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
        role: true,
        address: true,
        suburb: true,
        state: true,
        postcode: true,
        latitude: true,
        longitude: true,
        placeId: true,
        uiDensity: true,
        themePreference: true,
        invoicingCadence: true,
        invoiceDayOfWeek: true,
        invoiceDayOfMonth: true,
        profileEditingEnabled: true,
      } as any,
    })
    .catch(() => null);
  if (!user) redirect("/login");

  // Admins bypass the profile-editing lockout for themselves (matches v1).
  const editingEnabled =
    (user as any).role === Role.ADMIN ? true : (user as any).profileEditingEnabled !== false;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Your profile"
        description="Your contact details, security, and dashboard preferences."
      />

      <EstateProfile
        user={user as any}
        editingEnabled={editingEnabled}
        initialCadence={(user as any).invoicingCadence ?? undefined}
        initialDayOfWeek={(user as any).invoiceDayOfWeek ?? null}
        initialDayOfMonth={(user as any).invoiceDayOfMonth ?? null}
        initialDensity={(user as any).uiDensity ?? undefined}
        initialTheme={(user as any).themePreference ?? undefined}
      />
    </div>
  );
}
