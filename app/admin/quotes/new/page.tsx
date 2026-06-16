import { db } from "@/lib/db";
import { NewQuoteForm } from "@/components/admin/new-quote-form";
import { getAppSettings } from "@/lib/settings";

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

  return (
    <NewQuoteForm
      leads={leads}
      clients={clients.map((c) => ({ id: c.id, name: c.name, email: c.email ?? "", suburb: c.suburb }))}
      gstEnabled={settings.pricing.gstEnabled}
    />
  );
}
