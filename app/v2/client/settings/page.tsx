import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { ClientSettingsPanel } from "@/components/v2/client/settings-panel";
import { MarketingConsentCard } from "@/components/v2/client/marketing-consent-card";
import { ChevronRight, UserCog } from "lucide-react";

export const metadata = { title: "Settings · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientSettingsPage() {
  // The notification switches load on the client from /api/me/notification-switches.
  await requireRole([Role.CLIENT]);

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
      <ClientSettingsPanel />
      <MarketingConsentCard />
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
