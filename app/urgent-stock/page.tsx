import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { UrgentStockWorkspace } from "@/components/inventory/urgent-stock-workspace";
import { urgentStockOfficeHref } from "@/lib/inventory/urgent-stock-links";
import { urgentStockOfficeAllowed } from "@/lib/inventory/urgent-stock";
export const dynamic = "force-dynamic";

export default async function UrgentStockPage({ searchParams }: { searchParams?: { propertyId?: string } }) {
  const session = await requireSession();
  // The office (administrators, and since Wave F operations managers with the
  // inventory pack) works in the Stock page; notifications still link here.
  if (session.user.role !== Role.CLEANER && await urgentStockOfficeAllowed(session.user, "read")) redirect(urgentStockOfficeHref(searchParams?.propertyId));
  if (session.user.role !== Role.CLEANER) return <p>Urgent stock is available to administrators, operations managers with stock access and assigned cleaners.</p>;
  return <UrgentStockWorkspace isAdmin={false} initialPropertyId={searchParams?.propertyId} />;
}
