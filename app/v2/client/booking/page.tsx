import Link from "next/link";
import { createHash } from "crypto";
import { propertyScopeWhere, requireClientPortalPage } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { EstateBookingFlow } from "@/components/v2/client/booking-flow";
import { EAlert, EButton, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";
import { rebookSeed } from "@/lib/booking/rebook";

export const metadata = { title: "Book a clean · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientBookingPage({ searchParams = {} }: { searchParams?: { rebook?: string } }) {
  const portalCtx = await requireClientPortalPage({ module: "booking", permission: "bookings" });
  // Use the same authorized snapshot for the options, attribution and draft key.
  const properties = await db.property.findMany({
    where: { ...propertyScopeWhere(portalCtx), isActive: true },
    select: {
      id: true, name: true, suburb: true, bedrooms: true, bathrooms: true,
      client: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  }).catch(() => null);
  const sourceId = typeof searchParams.rebook === "string" ? searchParams.rebook : undefined;
  // The source is looked up under today's client/VA scope, never trusted from
  // the link. Its date, notes, prices and approvals are deliberately not read.
  const source = sourceId && properties ? await db.job.findFirst({
    where: { id: sourceId, property: { ...propertyScopeWhere(portalCtx), isActive: true }, isRework: false },
    select: { propertyId: true, jobType: true, status: true, isRework: true },
  }).catch(() => undefined) : null;
  const seed = sourceId ? rebookSeed(source ?? null, properties?.map(property => property.id) ?? []) : null;
  const formKey = JSON.stringify([
    portalCtx.actor, portalCtx.userId, portalCtx.clientId, portalCtx.team?.id ?? null,
    portalCtx.propertyIds === null ? null : [...portalCtx.propertyIds].sort(),
    properties?.map((property) => property.id).sort(),
    // A rebook draft cannot overwrite a separate ordinary booking in this tab.
    ...(sourceId ? [sourceId] : []),
  ]);

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

      {properties === null ? (
        <EAlert tone="danger" title="Properties could not be loaded">
          <p>Your booking options are unavailable. Please try again.</p>
          <a href="/v2/client/booking" className="underline">Retry</a>
        </EAlert>
      ) : source === undefined ? (
        <EAlert tone="danger" title="Previous clean unavailable">
          <p>The previous service could not be loaded. No booking has been sent.</p>
          <a href={`/v2/client/booking?rebook=${encodeURIComponent(sourceId!)}`} className="underline">Retry previous clean</a>
        </EAlert>
      ) : sourceId && !seed ? (
        <EAlert tone="danger" title="This clean cannot be rebooked">
          <p>The previous service or property is no longer available for booking in your current account.</p>
          <Link href="/v2/client/booking" className="underline">Start a new booking</Link>
        </EAlert>
      ) : properties.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing to book"
          title="No properties on file"
          description="Once a property is linked to your account you can request a clean here."
        />
      ) : (
        <>
        {seed ? <EAlert title="Rebook a previous clean"><p>Property and service are selected. Choose a new date and review current availability and pricing.</p></EAlert> : null}
        <EstateBookingFlow
          key={formKey}
          draftScope={createHash("sha256").update(formKey).digest("hex")}
          properties={properties.map(({ client, ...property }) => property)}
          actorName={portalCtx.userName ?? portalCtx.actorLabel}
          actingFor={properties[0].client.name}
          rebook={seed ?? undefined}
        />
        </>
      )}
    </div>
  );
}
