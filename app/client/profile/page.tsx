import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { redirect } from "next/navigation";
import { ClientProfileForm } from "@/components/client/client-profile-form";
import { DisplayPreferencesSection } from "@/components/profile/display-preferences-section";
import { BillingPreferencesSection } from "@/components/profile/billing-preferences-section";

export const dynamic = "force-dynamic";

export default async function ClientProfilePage() {
  await requireRole([Role.CLIENT]);
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const user = (await db.user.findUnique({
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
  })) as any;

  if (!user) redirect("/login");

  const editingEnabled = user.profileEditingEnabled !== false;

  const [pref, properties] = await Promise.all([
    user.clientId
      ? db.clientNotificationPreference.findUnique({ where: { clientId: user.clientId } })
      : null,
    user.clientId
      ? db.property.findMany({
          where: { clientId: user.clientId, isActive: true },
          select: { id: true, name: true, address: true, suburb: true },
          orderBy: { name: "asc" },
        })
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
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your contact details, billing, and how we reach you.
        </p>
      </header>

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
