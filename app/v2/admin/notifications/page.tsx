import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { CommsCenter } from "@/components/v2/admin/comms/comms-center";

export const metadata = { title: "Comms center · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminNotificationsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <CommsCenter />;
}
