import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { OnboardingWizard } from "@/components/v2/admin/onboarding/wizard";

export const metadata = { title: "New onboarding survey · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateNewOnboardingPage({
  searchParams,
}: {
  searchParams: { edit?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <OnboardingWizard editId={searchParams.edit} />;
}
