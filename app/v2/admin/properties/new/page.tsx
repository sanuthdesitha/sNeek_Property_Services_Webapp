import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { PropertyCreateForm } from "@/components/v2/admin/properties/property-create-form";
import { getPropertyFormConfig } from "@/lib/property-form/config-store";

export const metadata = { title: "Add property · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateNewPropertyPage({
  searchParams,
}: {
  searchParams: { clientId?: string; copyFrom?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const formConfig = await getPropertyFormConfig();

  return (
    <PropertyCreateForm
      initialClientId={searchParams.clientId}
      copyFromPropertyId={searchParams.copyFrom}
      formConfig={formConfig}
    />
  );
}
