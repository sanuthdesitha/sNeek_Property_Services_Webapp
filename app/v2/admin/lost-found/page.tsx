import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { LostFoundBoard } from "@/components/v2/admin/lost-found/lost-found-board";

export const metadata = { title: "Lost & found · Estate admin" };
export const dynamic = "force-dynamic";

// Estate-native lost & found board — report intake, workflow, and final-decision
// tracking over the LostFoundItem model. Admin / ops only.
export default async function V2AdminLostFoundPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <LostFoundBoard />;
}
