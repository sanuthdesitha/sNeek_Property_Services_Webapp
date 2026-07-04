import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { authOptions } from "@/lib/auth/auth-options";
import { ClientProfileForm } from "@/components/client/client-profile-form";
import { DisplayPreferencesSection } from "@/components/profile/display-preferences-section";
import { BillingPreferencesSection } from "@/components/profile/billing-preferences-section";
import { TwoFactorSettings } from "@/components/account/two-factor-settings";
import { EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Profile · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientProfilePage() {
  await requireRole([Role.CLIENT]);
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const user = (await db.user
    .findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        clientId: true,
        uiDensity: true,
        themePreference: true,
        invoicingCadence: true,
        invoiceDayOfWeek: true,
        invoiceDayOfMonth: true,
        address: true,
        suburb: true,
        state: true,
        postcode: true,
        latitude: true,
        longitude: true,
        placeId: true,
        profileEditingEnabled: true,
      } as any,
    })
    .catch(() => null)) as any;

  if (!user) redirect("/login");

  const editingEnabled = user.profileEditingEnabled !== false;

  const [pref, properties] = await Promise.all([
    user.clientId
      ? db.clientNotificationPreference.findUnique({ where: { clientId: user.clientId } }).catch(() => null)
      : null,
    user.clientId
      ? db.property
          .findMany({
            where: { clientId: user.clientId, isActive: true },
            select: { id: true, name: true, address: true, suburb: true },
            orderBy: { name: "asc" },
          })
          .catch(() => [])
      : [],
  ]);

  const comms = {
    notificationsEnabled: pref?.notificationsEnabled ?? true,
    notifyOnEnRoute: pref?.notifyOnEnRoute ?? true,
    notifyOnJobStart: pref?.notifyOnJobStart ?? true,
    notifyOnJobComplete: pref?.notifyOnJobComplete ?? true,
    preferredChannel: (pref?.preferredChannel ?? "EMAIL") as "EMAIL" | "SMS" | "BOTH",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Your profile"
        description="Manage your contact details, billing, and how we reach you."
      />

      <ClientProfileForm
        editingEnabled={editingEnabled}
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          address: user.address,
          suburb: user.suburb,
          state: user.state,
          postcode: user.postcode,
          latitude: user.latitude,
          longitude: user.longitude,
          placeId: user.placeId,
        }}
        comms={comms}
        properties={properties}
      />

      <TwoFactorSettings />

      <BillingPreferencesSection
        initialCadence={user.invoicingCadence ?? undefined}
        initialDayOfWeek={user.invoiceDayOfWeek ?? null}
        initialDayOfMonth={user.invoiceDayOfMonth ?? null}
      />

      <DisplayPreferencesSection
        initialDensity={user.uiDensity ?? undefined}
        initialTheme={user.themePreference ?? undefined}
      />
    </div>
  );
}
