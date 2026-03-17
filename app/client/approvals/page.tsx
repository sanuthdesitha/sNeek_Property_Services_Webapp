import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { ClientApprovalsClient } from "@/components/client/approvals-client";

export default async function ClientApprovalsPage() {
  await ensureClientModuleAccess("approvals");
  await requireRole([Role.CLIENT]);

  return <ClientApprovalsClient />;
}
