import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateProfile } from "@/components/v2/laundry/estate-profile";

export const metadata = { title: "Profile · Estate QA" };
export const dynamic = "force-dynamic";

// Mirrors app/qa/profile: same user query + endpoints (/api/me/profile,
// /api/me/preferences, /api/me/password, /api/auth/2fa/settings), Estate-native.
export default async function QaProfilePage() {
  await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);
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

  const editingEnabled =
    (user as any).role === Role.ADMIN ? true : (user as any).profileEditingEnabled !== false;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Your profile"
        description="Your contact details and preferences."
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
