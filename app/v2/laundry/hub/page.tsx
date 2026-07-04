import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { StaffWorkforceHub } from "@/components/workforce/staff-workforce-hub";
import { EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Team hub · Estate laundry" };
export const dynamic = "force-dynamic";

// Mirrors app/laundry/hub: reuses the exact StaffWorkforceHub client component.
export default async function LaundryHubPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Team hub"
        description="Shifts, availability and the laundry roster for the week."
      />
      <StaffWorkforceHub title="Laundry Team Hub" />
    </div>
  );
}
