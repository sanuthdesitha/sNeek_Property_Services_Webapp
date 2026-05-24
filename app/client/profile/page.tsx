import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { DisplayPreferencesSection } from "@/components/profile/display-preferences-section";
import { BillingPreferencesSection } from "@/components/profile/billing-preferences-section";
import { Button } from "@/components/ui/button";

export default async function ClientProfilePage() {
  await requireRole([Role.CLIENT]);
  const session = await getServerSession(authOptions);
  const userPrefs = session?.user?.id
    ? await db.user.findUnique({
        where: { id: session.user.id },
        select: {
          uiDensity: true,
          themePreference: true,
          invoicingCadence: true,
          invoiceDayOfWeek: true,
          invoiceDayOfMonth: true,
        } as any,
      })
    : null;
  const prefsAny = userPrefs as any;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your display preferences and account settings.</p>
      </div>
      <DisplayPreferencesSection
        initialDensity={userPrefs?.uiDensity ?? undefined}
        initialTheme={userPrefs?.themePreference ?? undefined}
      />
      <BillingPreferencesSection
        initialCadence={prefsAny?.invoicingCadence ?? undefined}
        initialDayOfWeek={prefsAny?.invoiceDayOfWeek ?? null}
        initialDayOfMonth={prefsAny?.invoiceDayOfMonth ?? null}
      />
      <div>
        <Button asChild variant="outline">
          <Link href="/client/settings">Edit account details</Link>
        </Button>
      </div>
    </div>
  );
}
