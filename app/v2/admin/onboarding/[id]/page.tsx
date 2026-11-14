import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resolveSurveyId } from "@/lib/onboarding/workspace/service";
import { OnboardingWorkspace } from "@/components/v2/admin/onboarding/workspace/onboarding-workspace";

export const metadata = { title: "Onboarding · Estate admin" };
export const dynamic = "force-dynamic";

/** The onboarding workspace. Accepts the OB number (new links) or the survey id (old links). */
export default async function EstateSurveyWorkspacePage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const surveyId = await resolveSurveyId(decodeURIComponent(params.id));
  if (!surveyId) notFound();
  return <OnboardingWorkspace key={surveyId} surveyId={surveyId} />;
}
