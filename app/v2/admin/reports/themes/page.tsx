import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { ThemeManager } from "@/components/v2/admin/reports/theme-manager";

export const metadata = { title: "Report themes · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Report themes (board "Report themes", 2026-11-17): a real page. Same guard
 * as before (ADMIN + OPS_MANAGER); an operations manager whose reports pack is
 * at View sees the list and the preview with no editing (the API refuses
 * their writes either way).
 */
export default async function V2AdminReportThemesPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const levels = await getOpsAccess(session.user);
  const canWrite = !levels || canUseOpsPath(levels, "/api/admin/report-themes", "POST");
  return (
    <div className="space-y-5">
      <EPageHeader
        eyebrow={
          <span>
            <Link href="/v2/admin/reports" className="underline">Insights</Link> · Client report PDFs
          </span>
        }
        title="Report themes"
        description="How the cleaning report a client receives after each clean looks: layout, photo size, colours, logo and which sections it includes."
        actions={
          <EButton variant="outline" size="sm" asChild>
            <Link href="/v2/admin/reports?tab=pdfs">Back to client report PDFs</Link>
          </EButton>
        }
      />
      <ThemeManager canWrite={canWrite} />
    </div>
  );
}
