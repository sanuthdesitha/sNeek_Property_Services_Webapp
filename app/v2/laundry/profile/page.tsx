import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateProfile } from "@/components/v2/laundry/estate-profile";

export const metadata = { title: "Profile · Estate laundry" };
export const dynamic = "force-dynamic";

// Mirrors app/laundry/profile: same user query + endpoints (/api/me/profile,
// /api/me/preferences, /api/me/password, /api/auth/2fa/settings), Estate-native.
export default async function LaundryProfilePage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
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
        latitude: true,
        longitude: true,
        placeId: true,
        bankAccountName: true,
        bankBsb: true,
        bankAccountNumber: true,
        abn: true,
        uiDensity: true,
        themePreference: true,
        invoicingCadence: true,
        invoiceDayOfWeek: true,
        invoiceDayOfMonth: true,
        preferredPayoutMethod: true,
        profileEditingEnabled: true,
      } as any,
    })
    .catch(() => null);
  if (!user) redirect("/login");

  const editingEnabled = (user as any).profileEditingEnabled !== false;

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
        showBanking
        showPayout
        initialCadence={(user as any).invoicingCadence ?? undefined}
        initialDayOfWeek={(user as any).invoiceDayOfWeek ?? null}
        initialDayOfMonth={(user as any).invoiceDayOfMonth ?? null}
        initialDensity={(user as any).uiDensity ?? undefined}
        initialTheme={(user as any).themePreference ?? undefined}
        initialPayout={(user as any).preferredPayoutMethod ?? undefined}
      />
    </div>
  );
}
