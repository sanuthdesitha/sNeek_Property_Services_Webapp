import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ComposeWorkspace } from "./compose-workspace";

export const dynamic = "force-dynamic";

export default async function MessagesComposePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <ComposeWorkspace />;
}
