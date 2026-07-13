import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QuoteDetail } from "@/components/v2/admin/quotes/quote-detail";

export const metadata = { title: "Quote · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2QuoteDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const quote = await db.quote
    .findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        serviceType: true,
        subtotal: true,
        gstAmount: true,
        totalAmount: true,
        notes: true,
        validUntil: true,
        createdAt: true,
        clientId: true,
        leadId: true,
        publicToken: true,
        showAddOnPrices: true,
        referenceImages: true,
        serviceContext: true,
        frequency: true,
        serviceAddress: true,
        serviceSuburb: true,
        requestedAddOns: true,
        discountCode: true,
        lineItems: true,
        client: {
          select: { id: true, name: true, email: true, address: true, suburb: true },
        },
        lead: {
          select: { id: true, name: true, email: true, address: true, suburb: true },
        },
      },
    })
    .catch(() => null);

  if (!quote) notFound();

  const clients = await db.client.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    take: 500,
    select: { id: true, name: true, email: true },
  });

  const initial = {
    id: quote.id,
    status: String(quote.status),
    serviceType: String(quote.serviceType),
    subtotal: Number(quote.subtotal ?? 0),
    gstAmount: Number(quote.gstAmount ?? 0),
    totalAmount: Number(quote.totalAmount ?? 0),
    notes: quote.notes ?? "",
    validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString() : null,
    createdAt: new Date(quote.createdAt).toISOString(),
    clientId: quote.clientId ?? null,
    client: quote.client
      ? {
          id: quote.client.id,
          name: quote.client.name,
          email: quote.client.email ?? "",
          address: quote.client.address ?? null,
          suburb: quote.client.suburb ?? null,
        }
      : null,
    lead: quote.lead
      ? {
          id: quote.lead.id,
          name: quote.lead.name,
          email: quote.lead.email ?? "",
          address: quote.lead.address ?? null,
          suburb: quote.lead.suburb ?? null,
        }
      : null,
    frequency: quote.frequency ?? null,
    serviceAddress: quote.serviceAddress ?? null,
    serviceSuburb: quote.serviceSuburb ?? null,
    publicToken: quote.publicToken ?? null,
    showAddOnPrices: Boolean(quote.showAddOnPrices),
    referenceImages: Array.isArray(quote.referenceImages)
      ? (quote.referenceImages as Array<Record<string, unknown>>)
          .filter((r) => r && typeof r.url === "string")
          .map((r) => ({
            key: typeof r.key === "string" ? r.key : String(r.url),
            url: String(r.url),
            label: typeof r.label === "string" ? r.label : undefined,
          }))
      : [],
    serviceContext:
      quote.serviceContext && typeof quote.serviceContext === "object" && !Array.isArray(quote.serviceContext)
        ? (quote.serviceContext as Record<string, string | number | boolean>)
        : null,
    requestedAddOns: Array.isArray(quote.requestedAddOns)
      ? (quote.requestedAddOns as Array<Record<string, unknown>>)
          .filter((r) => r && typeof r.label === "string")
          .map((r) => ({
            id: typeof r.id === "string" ? r.id : undefined,
            label: String(r.label),
            price: Number(r.price) || 0,
            note: typeof r.note === "string" ? r.note : undefined,
            requestedAt: typeof r.requestedAt === "string" ? r.requestedAt : undefined,
          }))
      : [],
    // Derive the current discount from the negative line item (this codebase's
    // convention), so the detail card shows the applied state on load.
    ...(() => {
      const lines = Array.isArray(quote.lineItems) ? (quote.lineItems as Array<Record<string, unknown>>) : [];
      const discountLine = lines.find((l) => Number(l?.total) < 0);
      const amount = lines.reduce((s, l) => s + Math.min(0, Number(l?.total) || 0), 0);
      return {
        discountCode: quote.discountCode ?? null,
        discountAmount: amount < 0 ? Math.abs(Number(amount.toFixed(2))) : 0,
        discountLabel: discountLine && typeof discountLine.label === "string" ? discountLine.label : null,
      };
    })(),
  };

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Growth"
        title="Quote detail"
        description="Review, address, and send this quote — same endpoints as the pipeline."
      />
      <QuoteDetail
        initial={initial}
        clients={clients.map((c) => ({ id: c.id, name: c.name, email: c.email ?? "" }))}
      />
    </div>
  );
}
