import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { QaInspectionWorkspace } from "@/components/v2/qa/qa-inspection-workspace";

export const metadata = { title: "Inspection · Estate QA" };
export const dynamic = "force-dynamic";

// The live Estate-native QA inspection workspace. Data + submit run client-side
// against the same endpoints v1 uses (GET/POST /api/qa/jobs/[id], the timer,
// uploads). This server page only gates the role and confirms the job exists.
export default async function QaInspectionPage({ params }: { params: { id: string } }) {
  await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);

  const exists = await db.job
    .findUnique({ where: { id: params.id }, select: { id: true } })
    .catch(() => null);
  if (!exists) notFound();

  return <QaInspectionWorkspace jobId={params.id} />;
}
