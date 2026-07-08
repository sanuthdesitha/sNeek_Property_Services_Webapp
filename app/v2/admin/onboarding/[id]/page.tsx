import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { SurveyDetail } from "@/components/v2/admin/onboarding/survey-detail";

export const metadata = { title: "Onboarding survey · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateSurveyDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <SurveyDetail id={params.id} />;
}
