import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EstateMessagesWorkspace } from "@/components/v2/admin/messages/messages-workspace";

export const metadata = { title: "Messages · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminMessagesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <EstateMessagesWorkspace />;
}
