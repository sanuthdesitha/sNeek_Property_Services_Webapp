import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getHiringApplicationDetail } from "@/lib/workforce/service";
import { CandidateWorkspace } from "@/components/v2/admin/hiring/application/candidate-workspace";

export const metadata = { title: "Candidate · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2CandidateDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const application = await getHiringApplicationDetail(params.id);
  if (!application) notFound();
  return <CandidateWorkspace application={JSON.parse(JSON.stringify(application))} />;
}
