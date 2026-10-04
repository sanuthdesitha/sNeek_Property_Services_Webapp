import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { UrgentStockWorkspace } from "@/components/inventory/urgent-stock-workspace";
export const dynamic = "force-dynamic";
export default async function UrgentStockPage({ searchParams }: { searchParams?: { propertyId?: string } }) {
  const session = await requireSession();
  if (session.user.role !== Role.ADMIN && session.user.role !== Role.CLEANER) return <p>Urgent stock is available to administrators and assigned cleaners.</p>;
  return <UrgentStockWorkspace isAdmin={session.user.role === Role.ADMIN} initialPropertyId={searchParams?.propertyId} />;
}
