import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
// Estate-native theme manager — same /api/admin/report-themes endpoints as the
// legacy /admin/reports/themes pages (list, create, set-default, edit layout),
// rendered entirely with Estate primitives.
import { ThemeManager } from "@/components/v2/admin/reports/theme-manager";

export const metadata = { title: "Report themes · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminReportThemesPage() {
  // Same guard as the v1 theme pages (ADMIN + OPS_MANAGER only).
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Quality"
        title="Report themes"
        description="Customise report layout, photo size, and branding for generated service reports."
        actions={
          <EButton variant="outline" size="sm" asChild>
            <Link href="/v2/admin/reports">Back to reports</Link>
          </EButton>
        }
      />
      <ThemeManager />
    </div>
  );
}
