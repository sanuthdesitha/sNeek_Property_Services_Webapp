import { db } from "@/lib/db";
import { NewQuoteForm } from "@/components/admin/new-quote-form";
import { getAppSettings } from "@/lib/settings";

export default async function NewQuotePage() {
  const [leads, settings] = await Promise.all([
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
    getAppSettings(),
  ]);

  return <NewQuoteForm leads={leads} gstEnabled={settings.pricing.gstEnabled} />;
}
