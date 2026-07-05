import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { ClientApprovalsBoard } from "@/components/v2/client/approvals-board";
import { EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Approvals · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientApprovalsPage() {
  await ensureClientModuleAccess("approvals");
  await requireRole([Role.CLIENT]);

  return (
    <div className="space-y-8">
      <EPageHeader
        eyebrow="SCHEDULING"
        title="Approvals"
        description="Review and approve optional extras before any work is billed to your account."
      />
      <ClientApprovalsBoard />
    </div>
  );
}
