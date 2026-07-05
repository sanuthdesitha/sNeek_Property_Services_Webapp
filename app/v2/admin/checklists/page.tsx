import { Role } from "@prisma/client";
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader, EButton } from "@/components/v2/ui/primitives";
import { EstateChecklistLibrary } from "@/components/v2/admin/checklists/checklist-library-editor";

export const metadata = { title: "Checklist library · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateChecklistsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Standards"
        title="Checklist library"
        description="The master checklist database — organised by room, appliance and outdoor modules. Every property's checklist is composed from these, filtered by its amenities."
        actions={
          <EButton variant="outline" size="sm" asChild>
            <Link href="/v2/admin/checklists/coverage">Property coverage →</Link>
          </EButton>
        }
      />
      <EstateChecklistLibrary />
    </div>
  );
}
