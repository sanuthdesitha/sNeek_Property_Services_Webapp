import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EstateComposeWorkspace } from "@/components/v2/admin/messages/compose-workspace";

export const metadata = { title: "Compose · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminMessagesComposePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <EstateComposeWorkspace />;
}
