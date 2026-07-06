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
        client: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, name: true, email: true } },
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
    client: quote.client ? { id: quote.client.id, name: quote.client.name, email: quote.client.email ?? "" } : null,
    lead: quote.lead ? { id: quote.lead.id, name: quote.lead.name, email: quote.lead.email ?? "" } : null,
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
