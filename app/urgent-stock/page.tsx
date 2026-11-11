import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { UrgentStockWorkspace } from "@/components/inventory/urgent-stock-workspace";
import { urgentStockOfficeHref } from "@/lib/inventory/urgent-stock-links";
export const dynamic = "force-dynamic";

export default async function UrgentStockPage({ searchParams }: { searchParams?: { propertyId?: string } }) {
  const session = await requireSession();
  // Administrators work in the Stock page (notifications still link here).
  if (session.user.role === Role.ADMIN) redirect(urgentStockOfficeHref(searchParams?.propertyId));
  if (session.user.role !== Role.CLEANER) return <p>Urgent stock is available to administrators and assigned cleaners.</p>;
  return <UrgentStockWorkspace isAdmin={false} initialPropertyId={searchParams?.propertyId} />;
}
