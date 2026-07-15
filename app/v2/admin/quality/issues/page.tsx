import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QaIssuesWorkspace } from "@/components/v2/admin/quality/qa-issues-workspace";

export const metadata = { title: "QA Issues · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminQaIssuesPage() {
  // QA inspectors may read; only ADMIN / OPS_MANAGER may action issues.
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
  const canManage = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;
  const settings = await getAppSettings();

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Quality"
        title="QA Issues"
        description="Every raised QA issue — rectification tracking, false-confirmation review, and deductions."
      />
      <QaIssuesWorkspace canManage={canManage} categories={settings.accountability.issueCategories} />
    </div>
  );
}
