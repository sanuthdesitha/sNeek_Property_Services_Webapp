import { db } from "@/lib/db";
import { NewQuoteForm } from "@/components/admin/new-quote-form";
import { getAppSettings } from "@/lib/settings";
import { SERVICE_CATALOG } from "@/lib/pricing/service-catalog";

export default async function NewQuotePage() {
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
    <NewQuoteForm
      leads={leads}
      clients={clients.map((c) => ({ id: c.id, name: c.name, email: c.email ?? "" }))}
      services={serviceOptions}
      gstEnabled={settings.pricing.gstEnabled}
    />
  );
}
