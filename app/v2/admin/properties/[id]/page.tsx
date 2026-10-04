import { OperationsButton } from "@/components/operations/ui";
import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { PropertyDetail } from "@/components/v2/admin/properties/property-detail";

export const metadata = { title: "Property · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstatePropertyDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <><OperationsButton asChild variant="outline" className="my-2"><Link href={`/property-care?propertyId=${params.id}`}>Property memory and care</Link></OperationsButton><PropertyDetail propertyId={params.id} /></>;
}
