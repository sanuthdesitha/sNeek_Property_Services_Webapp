import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AdminProfileForm } from "@/components/admin/admin-profile-form";
import { DisplayPreferencesSection } from "@/components/profile/display-preferences-section";
import { BillingPreferencesSection } from "@/components/profile/billing-preferences-section";
import { BiometricDevicesSection } from "@/components/profile/biometric-section";
import { TwoFactorSettings } from "@/components/account/two-factor-settings";
import { EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Profile · Estate QA" };
export const dynamic = "force-dynamic";

// Mirrors app/qa/profile: same user query, reuses the profile client sections.
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

      <div className="mx-auto max-w-3xl space-y-6">
        <AdminProfileForm user={user as any} editingEnabled={editingEnabled} />

        <BiometricDevicesSection />

        <TwoFactorSettings />

        <BillingPreferencesSection
          initialCadence={(user as any).invoicingCadence ?? undefined}
          initialDayOfWeek={(user as any).invoiceDayOfWeek ?? null}
          initialDayOfMonth={(user as any).invoiceDayOfMonth ?? null}
        />

        <DisplayPreferencesSection
          initialDensity={(user as any).uiDensity ?? undefined}
          initialTheme={(user as any).themePreference ?? undefined}
        />
      </div>
    </div>
  );
}
