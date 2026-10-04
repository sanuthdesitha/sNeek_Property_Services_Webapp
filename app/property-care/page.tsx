import { ensureClientModuleAccess } from "@/lib/portal-access";
import { requireRole } from "@/lib/auth/session";
import { PropertyCareWorkspace } from "@/components/property-care/workspace";
export const dynamic = "force-dynamic";
export default async function PropertyCarePage({ searchParams }: { searchParams?: { propertyId?: string } }) {
 const session = await requireRole(["ADMIN", "OPS_MANAGER", "CLIENT"]);
 if (session.user.role === "CLIENT") await ensureClientModuleAccess("properties");
 return <PropertyCareWorkspace propertyId={searchParams?.propertyId ?? ""} />;
}
