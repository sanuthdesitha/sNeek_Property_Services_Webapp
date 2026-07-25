import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EEyebrow } from "@/components/v2/ui/primitives";
import { RouteBuilder } from "@/components/v2/laundry/route-builder";

export const metadata = { title: "Route builder · Estate laundry" };
export const dynamic = "force-dynamic";

/**
 * /v2/laundry/route — plan today's run (candidates: today / tomorrow
 * pull-forward / overdue), or, when an ACTIVE route exists, the live runner
 * surface. All data flows through GET/POST /api/laundry/route.
 */
export default async function LaundryRoutePage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>LAUNDRY OPERATIONS · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Today&apos;s run.</h1>
        <div className="e-signature-rule mt-4" />
      </header>
      <RouteBuilder />
    </div>
  );
}
