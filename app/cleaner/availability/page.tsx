import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { CleanerAvailabilityPage } from "@/components/cleaner/availability-page";

export default async function CleanerAvailabilityRoutePage() {
  await requireRole([Role.CLEANER]);
  return <CleanerAvailabilityPage />;
}
