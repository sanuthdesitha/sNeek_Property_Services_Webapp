import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { authOptions } from "@/lib/auth/auth-options";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ProfileSettings } from "@/components/v2/client/profile/profile-settings";

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
        invoicingCadence: true,
        invoiceDayOfWeek: true,
        invoiceDayOfMonth: true,
        address: true,
        suburb: true,
        state: true,
        postcode: true,
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
        title="Profile & security"
        description="Manage your contact details, billing, security, and how we reach you."
      />

      <ProfileSettings
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
        }}
        comms={comms}
        properties={properties as { id: string; name: string; address: string; suburb: string }[]}
        billing={{
          cadence: (user.invoicingCadence ?? "ON_COMPLETION") as any,
          dayOfWeek: user.invoiceDayOfWeek ?? null,
          dayOfMonth: user.invoiceDayOfMonth ?? null,
        }}
      />
    </div>
  );
}
