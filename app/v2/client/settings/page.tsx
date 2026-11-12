import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { ClientSettingsPanel, type SettingsComms } from "@/components/v2/client/settings-panel";
import { ChevronRight, UserCog } from "lucide-react";

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
      <Link
        href="/v2/client/profile"
        className="flex min-h-12 items-center justify-between gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3 text-[0.875rem] font-[550] hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2"
      >
        Profile, billing and security · passkey
        <ChevronRight className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" aria-hidden />
      </Link>
    </div>
  );
}
