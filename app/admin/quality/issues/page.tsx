import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui/page-header";
import { ShieldAlert } from "lucide-react";
import { QaIssuesWorkspace } from "@/components/admin/qa-issues-workspace";

export const dynamic = "force-dynamic";

export default async function AdminQaIssuesPage() {
  // The admin layout already restricts to ADMIN / OPS_MANAGER, so anyone here
  // may action issues.
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ShieldAlert />}
        title="QA Issues"
        description="Every raised QA issue — rectification tracking, false-confirmation review, and deductions."
      />
      <QaIssuesWorkspace canManage categories={settings.accountability.issueCategories} />
    </div>
  );
}
