import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { OnboardingStart } from "@/components/v2/admin/onboarding/workspace/onboarding-start";

export const metadata = { title: "Start onboarding · Estate admin" };
export const dynamic = "force-dynamic";

/** Old links to /v2/admin/onboarding/new?edit=<id> still open the same draft (now in the workspace). */
export default async function EstateNewOnboardingPage({ searchParams }: { searchParams: { edit?: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  if (searchParams.edit) redirect(`/v2/admin/onboarding/${encodeURIComponent(searchParams.edit)}`);
  return <OnboardingStart />;
}
