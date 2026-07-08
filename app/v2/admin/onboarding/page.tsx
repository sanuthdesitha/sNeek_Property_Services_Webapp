import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { OnboardingSurveysBoard } from "@/components/v2/admin/onboarding/surveys-board";

export const metadata = { title: "Property onboarding · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateOnboardingPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <OnboardingSurveysBoard />;
}
