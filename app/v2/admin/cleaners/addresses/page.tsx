import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Role } from "@prisma/client";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { getServerMapsKey } from "@/lib/maps/server-key";
import { loadHomeAddresses, recordHomeAddressesViewed } from "@/lib/workforce/home-addresses";
import { HomeAddressNotes, HomeAddressesWorkspace } from "@/components/v2/admin/cleaners/home-addresses-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cleaner home addresses · Estate admin" };

/**
 * Cleaner home addresses (board "Cleaner home addresses", 2026-11-17).
 * ADMIN only, checked before anything is read; while testing as another
 * account the tested account's rights apply (a cleaner sees nothing).
 *
 * Every opening is written to the activity log before the addresses are
 * shown (owner default, pending confirmation): if the record cannot be
 * written the page does not show them. The browser receives street addresses
 * for the table only; map pins are suburb level and carry no stored position.
 */
export default async function CleanerAddressesPage() {
  const session = await requireRole([Role.ADMIN]);
  const [view, mapsKey] = await Promise.all([loadHomeAddresses(), getServerMapsKey()]);
  await recordHomeAddressesViewed({
    actorId: session.impersonation?.actorId ?? session.user.id,
    effectiveUserId: session.user.id,
    activeCleaners: view.counts.active,
  });
  return (
    <div className="space-y-5">
      <EButton asChild variant="ghost" size="sm">
        <Link href="/v2/admin/cleaners">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Cleaners
        </Link>
      </EButton>
      <EPageHeader
        eyebrow="People and quality · Accounts"
        title="Cleaner home addresses"
        description="Residential details on file for active cleaners. Administrators only."
      />
      <HomeAddressNotes />
      <HomeAddressesWorkspace rows={view.rows} pins={view.pins} counts={view.counts} mapConfigured={Boolean(mapsKey)} />
    </div>
  );
}
