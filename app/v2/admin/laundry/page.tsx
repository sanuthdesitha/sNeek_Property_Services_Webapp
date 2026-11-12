import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { LaundryWorkspace } from "@/components/v2/admin/laundry/laundry-workspace";
import { getAppSettings } from "@/lib/settings";

export const metadata = { title: "Laundry · Estate admin" };
export const dynamic = "force-dynamic";

export default async function AdminLaundryPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  return <LaundryWorkspace canReviewBags={session.user.role === Role.ADMIN} timeZone={settings?.timezone || "Australia/Sydney"} />;
}
