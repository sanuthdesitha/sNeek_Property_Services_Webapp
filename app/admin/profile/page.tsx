import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { AdminProfileForm } from "@/components/admin/admin-profile-form";
import { DisplayPreferencesSection } from "@/components/profile/display-preferences-section";
import { BillingPreferencesSection } from "@/components/profile/billing-preferences-section";

export const dynamic = "force-dynamic";

export default async function AdminProfilePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
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
      uiDensity: true,
      themePreference: true,
      invoicingCadence: true,
      invoiceDayOfWeek: true,
      invoiceDayOfMonth: true,
    } as any,
  });
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Your Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your contact info and preferences.</p>
      </header>

      <AdminProfileForm user={user as any} />

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
  );
}
