import { Suspense } from "react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { OnboardingList } from "@/components/v2/admin/onboarding/workspace/onboarding-list";

export const metadata = { title: "Property onboarding · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateOnboardingPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <Suspense>
      <OnboardingList isAdmin={session.user.role === Role.ADMIN} />
    </Suspense>
  );
}
