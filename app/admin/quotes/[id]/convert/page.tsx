import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { ConvertQuoteForm } from "@/components/admin/convert-quote-form";

export default async function ConvertQuotePage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const quote = await db.quote.findUnique({
    where: { id: params.id },
    select: { id: true, serviceType: true, status: true },
  });
  if (!quote) notFound();

  const properties = await db.property.findMany({
    where: { isActive: true },
    select: { id: true, name: true, suburb: true },
    orderBy: [{ name: "asc" }],
  });

  return <ConvertQuoteForm quoteId={quote.id} serviceType={quote.serviceType} properties={properties} />;
}
