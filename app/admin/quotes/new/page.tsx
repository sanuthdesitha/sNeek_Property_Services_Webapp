import { db } from "@/lib/db";
import { NewQuoteForm } from "@/components/admin/new-quote-form";

export default async function NewQuotePage() {
  const leads = await db.quoteLead.findMany({
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
  });

  return <NewQuoteForm leads={leads} />;
}
