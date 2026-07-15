import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AdminQualityInspection } from "@/components/v2/admin/quality/admin-quality-inspection";

export const metadata = { title: "Inspection · Estate admin" };
export const dynamic = "force-dynamic";

// Deep-linkable admin QA inspection. The queue at /v2/admin/quality (and QA
// notifications) link here by QaAssignment id; we resolve it to the underlying
// job and hand off to the shared inspection workspace, which loads the job's
// submission + template and persists the review against /api/qa/jobs/[id]. This
// server page only gates the admin/ops role and confirms the assignment exists.
export default async function AdminQualityInspectionPage({
  params,
}: {
  params: { assignmentId: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const assignment = await db.qaAssignment
    .findUnique({
      where: { id: params.assignmentId },
      select: { jobId: true },
    })
    .catch(() => null);

  if (!assignment) notFound();

  return <AdminQualityInspection jobId={assignment.jobId} />;
}
