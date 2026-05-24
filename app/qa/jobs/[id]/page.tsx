import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { QaJobClient } from "@/components/qa/qa-job-client";

export default async function QaJobPage({ params }: { params: { id: string } }) {
  await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);
  return <QaJobClient jobId={params.id} />;
}
