import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { opsLevelAllows } from "@/lib/rbac/ops-catalog";
import { qualityHubAccess } from "@/lib/quality/hub-access";
import { QualityHub } from "@/components/v2/admin/quality/hub/quality-hub";

export const metadata = { title: "Quality · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Quality hub: review queue, issues, cleaners, inspectors, categories and
 * coaching on one page with one period and one filter set (URL state).
 * /quality/issues, /quality/accountability and /quality/qa-performance
 * redirect to their tabs; /quality/[assignmentId] (inspection) is unchanged.
 *
 * Access is what each old page allowed: ADMIN and OPS_MANAGER see every tab;
 * a QA inspector (who could read the QA issue register) sees the Issues tab
 * only, read-only. An operations manager whose quality pack is read-only
 * also sees no actions, since the action endpoints would refuse them. The
 * Coaching tab is hidden when its endpoints (coaching records, cleaner list)
 * would refuse the manager, and "Review bonus" when payroll would.
 */
export default async function AdminQualityPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
  const role = session.user.role;
  const isManager = role === Role.ADMIN || role === Role.OPS_MANAGER;
  const levels = isManager ? await getOpsAccess(session.user) : null;
  const canManage = isManager && (!levels || opsLevelAllows(levels.quality, "PATCH"));
  const access = qualityHubAccess(levels ?? null, canManage);
  const settings = await getAppSettings().catch(() => null);
  const deduction = settings?.accountability.scoring.falseConfirmationExtraDeduction;

  return (
    <QualityHub
      context={{
        canManage,
        inspectorView: !isManager,
        coaching: isManager ? access.coaching : { visible: false, canManage: false, fullPageLink: false },
        canDecideBonus: isManager && access.canDecideBonus,
        timeZone: settings?.timezone || "Australia/Sydney",
        falseConfirmationDeduction: typeof deduction === "number" ? deduction : null,
      }}
    />
  );
}
