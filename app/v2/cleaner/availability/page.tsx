import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerAvailabilityPage } from "@/components/cleaner/availability-page";

export const metadata = { title: "Availability · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Estate wrapper for the live cleaner availability workspace. Auth + data source
 * are identical to the legacy `app/cleaner/availability` route: the mounted
 * `CleanerAvailabilityPage` client component owns its own fetches/mutations
 * (weekly hours + time-off), scoped to the session cleaner by its endpoints.
 */
export default async function V2CleanerAvailabilityPage() {
  await requireRole([Role.CLEANER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Schedule"
        title="Availability"
        description="Set the hours you're free to work and log any time off."
      />
      <CleanerAvailabilityPage />
    </div>
  );
}
