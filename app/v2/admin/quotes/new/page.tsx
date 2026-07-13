import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { SERVICE_CATALOG } from "@/lib/pricing/service-catalog";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QuoteBuilder } from "@/components/v2/admin/quotes/quote-builder";

export const metadata = { title: "New quote · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2NewQuotePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

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

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Growth"
        title="New quote"
        description="Quote an existing client or a new lead, priced per service from your rate card."
      />
      <QuoteBuilder
        leads={leads}
        clients={clients.map((c) => ({ id: c.id, name: c.name, email: c.email ?? "", suburb: c.suburb ?? null }))}
        services={serviceOptions}
        gstEnabled={settings.pricing.gstEnabled}
        pricingVariables={settings.pricingVariables}
      />
    </div>
  );
}
