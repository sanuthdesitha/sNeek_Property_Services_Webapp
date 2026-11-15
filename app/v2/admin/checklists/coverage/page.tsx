import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EstateChecklistCoverage } from "@/components/v2/admin/checklists/checklist-coverage";

export const metadata = { title: "Checklist coverage · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Checklist coverage (board "Checklist coverage", 2026-11-17): a real page.
 * Its heading, breadcrumb (Forms › Checklist blocks) and header actions are
 * drawn by the workspace because the header action counts its rows.
 */
export default async function EstateChecklistCoveragePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <EstateChecklistCoverage />;
}
