import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getHiringApplicationDetail } from "@/lib/workforce/service";
import { CandidateDetail } from "@/components/hiring/candidate-detail";

export const dynamic = "force-dynamic";

export default async function CandidateDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const application = await getHiringApplicationDetail(params.id);
  if (!application) notFound();
  return <CandidateDetail application={JSON.parse(JSON.stringify(application))} />;
}
