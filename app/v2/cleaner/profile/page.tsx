import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateProfile } from "@/components/v2/laundry/estate-profile";

export const metadata = { title: "Profile · Estate cleaner" };
export const dynamic = "force-dynamic";

// Fully native Estate cleaner profile. Reuses the shared v2 EstateProfile kit
// (contact, banking, payout, invoicing prefs, theme, password, 2FA) — the same
// component the laundry/QA portals mount — wired to the SAME /api/me/* endpoints
// the live cleaner profile uses. Cleaners have banking + payout details, so both
// showBanking and showPayout are on.
export default async function CleanerProfilePage() {
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

  const editingEnabled = (user as any)?.profileEditingEnabled !== false;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Your profile"
        description="Your contact, banking and payout details, preferences and security."
      />

      {user ? (
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
      ) : (
        <p className="mx-auto max-w-3xl text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          We couldn&apos;t load your profile right now. Refresh the page to try again.
        </p>
      )}
    </div>
  );
}
