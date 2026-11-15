import { notFound } from "next/navigation";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resolveRouteRole } from "@/lib/auth/route-role";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { opsLevelAllows } from "@/lib/rbac/ops-catalog";
import { loadInspectionRecord, loadInspectionStatus } from "@/lib/quality/inspection-record";
import { AdminQualityInspection } from "@/components/v2/admin/quality/admin-quality-inspection";
import { InspectionRecordView } from "@/components/v2/admin/quality/record/inspection-record-view";

export const metadata = { title: "Inspection · Estate admin" };
export const dynamic = "force-dynamic";

const PAGE_ROLES = [Role.ADMIN, Role.OPS_MANAGER] as const;

/**
 * Deep-linkable admin QA inspection, by QaAssignment id (the Quality queue and
 * QA notifications link here).
 *
 * - A submitted inspection opens as the inspection record (board
 *   "QualityInspection"): the office view, read from
 *   lib/quality/inspection-record.ts, with reopen, AI photo review decisions
 *   and links into the issues.
 * - An inspection that is not submitted yet, or `?view=workspace`, opens the
 *   shared inspection workspace exactly as before (same GET/POST
 *   /api/qa/jobs/[id] endpoints), so grading and everything it offers stays
 *   reachable.
 *
 * Access is unchanged: ADMIN and OPS_MANAGER (live role guard). Actions are
 * shown only when the viewer's quality pack allows changes; every action's
 * route checks again on the server.
 */
export default async function AdminQualityInspectionPage({
  params,
  searchParams,
}: {
  params: { assignmentId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireRole([...PAGE_ROLES]);

  const status = await loadInspectionStatus(params.assignmentId).catch(() => null);
  if (!status) notFound();

  const wantsWorkspace = searchParams?.view === "workspace";
  if (wantsWorkspace || status.status !== QaAssignmentStatus.COMPLETED || !status.hasSubmission) {
    return <AdminQualityInspection jobId={status.jobId} />;
  }

  const role = resolveRouteRole(session.user, PAGE_ROLES);
  const record = await loadInspectionRecord(params.assignmentId, { id: session.user.id, role });
  // A submission that cannot be read as a record still opens in the workspace.
  if (!record) return <AdminQualityInspection jobId={status.jobId} />;

  const levels = role === Role.OPS_MANAGER ? await getOpsAccess(session.user) : null;
  const canManage = !levels || opsLevelAllows(levels.quality, "PATCH");

  return <InspectionRecordView record={record} canManage={canManage} />;
}
