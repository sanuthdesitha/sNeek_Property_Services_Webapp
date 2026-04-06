import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { RewardsPage } from "@/components/client/rewards-page";

export default async function ClientReferralsPage() {
  await requireRole([Role.CLIENT]);
  return <RewardsPage />;
}
