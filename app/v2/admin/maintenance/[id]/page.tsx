import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EstateMaintenanceDetail } from "@/components/v2/admin/maintenance/maintenance-detail";

export const metadata = { title: "Maintenance item · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Maintenance item page (board "Maintenance item"). Same role gate as the list.
 * `?back=` carries the list's view for the back link (restricted to this page).
 */
export default async function EstateMaintenanceDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  const back = typeof searchParams?.back === "string" ? searchParams.back : null;
  return (
    <EstateMaintenanceDetail
      itemId={params.id}
      timeZone={settings?.timezone || "Australia/Sydney"}
      isAdmin={session.user.role === Role.ADMIN}
      back={back}
    />
  );
}
