import { Suspense } from "react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { DeepCleanScheduling } from "@/components/v2/admin/properties/deep-clean-scheduling";

export const metadata = { title: "Deep-clean scheduling · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Deep-clean scheduling (board "Deep clean", 2026-11-16). ADMIN and
 * OPS_MANAGER read it (Properties pack); only ADMIN verifies and chooses the
 * day (the property planning route's POST is ADMIN only). `?property=<id>`
 * opens the date panel, `?verify=<id>` the verify section.
 */
export default async function DeepCleanPlanningPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <Suspense fallback={null}>
      <DeepCleanScheduling />
    </Suspense>
  );
}
