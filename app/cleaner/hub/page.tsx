import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { StaffWorkforceHub } from "@/components/workforce/staff-workforce-hub";

export default async function CleanerHubPage() {
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return <StaffWorkforceHub title="Cleaner Team Hub" />;
}

