import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { SERVICE_CATALOG } from "@/lib/pricing/service-catalog";
import { ECard, ECardBody, EPageHeader, EButton } from "@/components/v2/ui/primitives";
import { QuoteBuilder, type QuoteEditSeed } from "@/components/v2/admin/quotes/quote-builder";
import Link from "next/link";

export const metadata = { title: "Edit quote · Estate admin" };
export const dynamic = "force-dynamic";

type LineItem = { label: string; unitPrice: number; qty: number; total: number };
type ReferenceImage = { key: string; url: string; label?: string };

export default async function V2EditQuotePage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const quote = await db.quote
    .findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        serviceType: true,
        frequency: true,
        serviceAddress: true,
        serviceSuburb: true,
        subtotal: true,
        gstAmount: true,
        totalAmount: true,
        notes: true,
        validUntil: true,
        clientId: true,
        leadId: true,
        showAddOnPrices: true,
        referenceImages: true,
        serviceContext: true,
        lineItems: true,
        client: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, name: true, email: true } },
      },
    })
    .catch(() => null);

  if (!quote) notFound();

  // Converted quotes are owned by their job — edits are blocked (route + here).
  if (String(quote.status) === "CONVERTED") {
    return (
      <div className="space-y-6">
        <EPageHeader eyebrow="Growth" title="Edit quote" description="This quote can no longer be edited." />
        <ECard>
          <ECardBody className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              This quote was converted to a job and can&apos;t be edited.
            </p>
            <EButton asChild variant="outline" size="sm">
              <Link href={`/v2/admin/quotes/${quote.id}`}>Back to quote</Link>
            </EButton>
          </ECardBody>
        </ECard>
      </div>
    );
  }

  const [leads, clients, settings] = await Promise.all([
    db.quoteLead.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        email: true,
        suburb: true,
        serviceType: true,
        bedrooms: true,
        bathrooms: true,
        estimateMin: true,
        estimateMax: true,
      },
    }),
    db.client.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, email: true, suburb: true },
    }),
    getAppSettings(),
  ]);

  const serviceOptions = SERVICE_CATALOG.map((c) => ({
    jobType: c.jobType as string,
    label: c.label,
    model: c.model,
    itemLabel: c.itemLabel ?? null,
    unitLabel: c.unitLabel ?? null,
    bands: (c.rate.bands ?? []).map((b) => ({ label: b.label })),
  }));

  const referenceImages: ReferenceImage[] = Array.isArray(quote.referenceImages)
    ? (quote.referenceImages as Array<Record<string, unknown>>)
        .filter((r) => r && typeof r.url === "string")
        .map((r) => ({
          key: typeof r.key === "string" ? r.key : String(r.url),
          url: String(r.url),
          label: typeof r.label === "string" ? r.label : undefined,
        }))
    : [];

  const lineItems: LineItem[] = Array.isArray(quote.lineItems)
    ? (quote.lineItems as Array<Record<string, unknown>>).map((li) => ({
        label: typeof li.label === "string" ? li.label : "",
        unitPrice: Number(li.unitPrice ?? 0),
        qty: Number(li.qty ?? 0),
        total: Number(li.total ?? 0),
      }))
    : [];

  const editQuote: QuoteEditSeed = {
    id: quote.id,
    status: String(quote.status),
    serviceType: String(quote.serviceType),
    frequency: quote.frequency ?? null,
    serviceAddress: quote.serviceAddress ?? null,
    serviceSuburb: quote.serviceSuburb ?? null,
    clientId: quote.clientId ?? null,
    leadId: quote.leadId ?? null,
    leadName: quote.lead?.name ?? null,
    serviceContext:
      quote.serviceContext && typeof quote.serviceContext === "object" && !Array.isArray(quote.serviceContext)
        ? (quote.serviceContext as Record<string, string | number | boolean>)
        : null,
    referenceImages,
    showAddOnPrices: Boolean(quote.showAddOnPrices),
    lineItems,
    notes: quote.notes ?? "",
    validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString() : null,
  };

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Growth"
        title="Edit quote"
        description="Change the service, pricing, extras, checklist, notes and client — then save."
      />
      <QuoteBuilder
        editQuote={editQuote}
        leads={leads}
        clients={clients.map((c) => ({ id: c.id, name: c.name, email: c.email ?? "", suburb: c.suburb ?? null }))}
        services={serviceOptions}
        gstEnabled={settings.pricing.gstEnabled}
        pricingVariables={settings.pricingVariables}
      />
    </div>
  );
}
