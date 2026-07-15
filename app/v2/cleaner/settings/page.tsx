import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateProfile } from "@/components/v2/laundry/estate-profile";

export const metadata = { title: "Settings · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Native Estate cleaner settings — security + preferences focus. Reuses the
 * shared v2 EstateProfile kit (an allowed v2 component) with banking hidden, so
 * it surfaces contact, display preferences (theme/density), password, and 2FA —
 * the same account controls the legacy `/cleaner/settings` offered — wired to
 * the SAME /api/me/* + /api/auth/2fa endpoints. No v1 UI is imported.
 */
export default async function CleanerSettingsPage() {
  const session = await requireRole([Role.CLEANER]);

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
        uiDensity: true,
        themePreference: true,
        preferredTransport: true,
        profileEditingEnabled: true,
      } as any,
    })
    .catch(() => null);

  const editingEnabled = (user as any)?.profileEditingEnabled !== false;

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Account" title="Settings" description="Your contact details, display preferences, and security." />
      {user ? (
        <EstateProfile
          user={user as any}
          editingEnabled={editingEnabled}
          initialDensity={(user as any).uiDensity ?? undefined}
          initialTheme={(user as any).themePreference ?? undefined}
          initialTransport={(user as any).preferredTransport ?? undefined}
        />
      ) : (
        <p className="mx-auto max-w-3xl text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          We couldn&apos;t load your settings right now. Refresh the page to try again.
        </p>
      )}
    </div>
  );
}
