import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateFormsList } from "@/components/v2/admin/forms/management/estate-forms-list";

export const metadata = { title: "Forms · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateFormsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const tab = searchParams.tab === "checklists" ? "checklists" : "templates";

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Standards"
        title="Forms"
        description="Job form templates and the per-service checklists they are built from — publish what cleaners fill in on site."
      />
      <EstateFormsList tab={tab} />
    </div>
  );
}
