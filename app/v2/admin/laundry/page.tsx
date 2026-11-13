import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { LaundryWorkspace } from "@/components/v2/admin/laundry/laundry-workspace";
import { getAppSettings } from "@/lib/settings";
import { can } from "@/lib/rbac/can";

export const metadata = { title: "Laundry · Estate admin" };
export const dynamic = "force-dynamic";

export default async function AdminLaundryPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  // Change state and Void on the Pipeline (2026-11-14): the same rules the routes enforce.
  const impersonating = Boolean((session as { impersonation?: unknown }).impersonation);
  const [canChangeState, canVoidCapability] = await Promise.all([
    can(session, "laundry.change_state").catch(() => false),
    can(session, "laundry.void").catch(() => false),
  ]);
  const runTools = {
    canChangeState,
    canVoid: canVoidCapability && !impersonating,
    voidBlockedReason: !canVoidCapability ? "Voiding is for administrators." : impersonating ? "Voiding needs your own PIN, so it is not offered while testing as someone." : null,
  };
  return <LaundryWorkspace canReviewBags={session.user.role === Role.ADMIN} timeZone={settings?.timezone || "Australia/Sydney"} runTools={runTools} />;
}
