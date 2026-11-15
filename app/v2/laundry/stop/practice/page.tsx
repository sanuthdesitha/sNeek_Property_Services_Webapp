import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { StopScreen, type StopScreenTask } from "@/components/v2/laundry/portal/stop-screen";
import { PracticeBoundary } from "@/components/v2/tutorials/practice-boundary";
import { PRACTICE_PROPERTY } from "@/lib/tutorials/practice-samples";

export const metadata = { title: "Practice stop · Estate laundry" };
export const dynamic = "force-dynamic";

/**
 * "Confirm a pickup" practice (board "Phone tours", 12): the real stop screen
 * with a sample run at Practice: Demo Cottage. Nothing is read from or written
 * to the database; the practice guard stops the pickup request in the browser,
 * so no run advances and no count is recorded.
 */
export default async function LaundryPracticeStopPage() {
  const session = await requireRole([Role.LAUNDRY]);
  const today = new Date().toISOString();
  const task: StopScreenTask = {
    id: "practice-stop",
    status: "CONFIRMED",
    updatedAt: today,
    pickupDate: today,
    dropoffDate: today,
    property: { name: PRACTICE_PROPERTY.name, suburb: PRACTICE_PROPERTY.suburb, address: `${PRACTICE_PROPERTY.address}, ${PRACTICE_PROPERTY.suburb}` },
    confirmations: [],
  };
  return (
    <PracticeBoundary tourKey="laundry.pickup.practice">
      <StopScreen
        task={task}
        kind="PICKUP"
        viewerId={session.user.id}
        stopLabel="Practice stop · planned 2:30 pm"
        cleaner={{ byName: "Practice cleaner", atLabel: "13:05", ready: true, bagCount: 2, location: "Behind the front door", photoUrl: null }}
        expected={2}
        baselineId={null}
        officePhone={null}
      />
    </PracticeBoundary>
  );
}
