import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { NewClientForm } from "@/components/v2/admin/clients/new-client-form";

export const metadata = { title: "Add client · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2NewClientPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Clients"
        title="Add client"
        description="Create a new client account and profile."
      />
      <NewClientForm />
    </div>
  );
}
