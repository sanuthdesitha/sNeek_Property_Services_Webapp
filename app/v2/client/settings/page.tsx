import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { ClientSettingsPanel, type SettingsComms } from "@/components/v2/client/settings-panel";
import { UserCog } from "lucide-react";

export const metadata = { title: "Settings · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientSettingsPage() {
  const session = await requireRole([Role.CLIENT]);

  const user = await db.user
    .findUnique({ where: { id: session.user.id }, select: { clientId: true } })
    .catch(() => null);

  const pref = user?.clientId
    ? await db.clientNotificationPreference
        .findUnique({ where: { clientId: user.clientId } })
        .catch(() => null)
    : null;

  const comms: SettingsComms = {
    notificationsEnabled: pref?.notificationsEnabled ?? true,
    notifyOnEnRoute: pref?.notifyOnEnRoute ?? true,
    notifyOnJobStart: pref?.notifyOnJobStart ?? true,
    notifyOnJobComplete: pref?.notifyOnJobComplete ?? true,
    preferredChannel: (pref?.preferredChannel ?? "EMAIL") as SettingsComms["preferredChannel"],
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Settings"
        description="Notification preferences and appearance. Contact details, billing, and security live in your profile."
        actions={
          <EButton asChild variant="outline" size="sm">
            <Link href="/v2/client/profile">
              <UserCog className="h-3.5 w-3.5" /> Profile &amp; security
            </Link>
          </EButton>
        }
      />
      <ClientSettingsPanel comms={comms} />
    </div>
  );
}
