import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
// Approvals (2026-11 redesign, board "Approvals"): queues on the left with real
// counts, the selected queue as a table, each queue's own decision in the side
// panel (?open=), bulk decisions where a queue allows them, and the Decided
// tab. Header and h1 are rendered by the workspace (its line carries live counts).
import { ApprovalsWorkspace } from "@/components/v2/admin/approvals/approvals-workspace";

export const metadata = { title: "Approvals · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminApprovalsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  return <ApprovalsWorkspace timezone={settings?.timezone ?? "Australia/Sydney"} />;
}
