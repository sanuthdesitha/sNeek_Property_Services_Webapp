import Link from "next/link";
import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { listClientPropertiesForUser } from "@/lib/client/portal-data";
import { EstateBookingFlow } from "@/components/v2/client/booking-flow";
import { EButton, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Book a clean · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientBookingPage() {
  const portalCtx = await requireClientPortalPage({ module: "booking", permission: "bookings" });
  // Shim: downstream code reads session.user.id — for a VA that is THEIR id,
  // and the VA-aware resolvers scope it to their team's client and properties.
  const session = { user: { id: portalCtx.userId, name: portalCtx.userName } };
  const properties = await listClientPropertiesForUser(session.user.id).catch(() => []);

  return (
    <div className="space-y-8">
      <EPageHeader
        eyebrow="SCHEDULING"
        title="Book a clean"
        description="Pick a property and service, choose from available dates, and we'll take it from there."
        actions={
          <EButton asChild variant="outline" size="sm"><Link href="/v2/client/jobs">View jobs</Link></EButton>
        }
      />

      {properties.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing to book"
          title="No properties on file"
          description="Once a property is linked to your account you can request a clean here."
        />
      ) : (
        <EstateBookingFlow properties={properties} />
      )}
    </div>
  );
}
