import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { StaffWorkforceHub } from "@/components/workforce/staff-workforce-hub";

export default async function LaundryHubPage() {
  await requireRole([Role.LAUNDRY]);
  return <StaffWorkforceHub title="Laundry Team Hub" />;
}

