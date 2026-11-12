import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { OfficeRequestsInbox } from "@/components/v2/laundry/portal/office-requests-inbox";
import { listOfficeRequestsForLaundryUser, OFFICE_REQUEST_WINDOW_HOURS, openRequestCount } from "@/lib/laundry/office-requests";
import type { OfficeRequestsResponse } from "@/lib/laundry/office-request-types";
import { sydneyTodayKey } from "@/lib/time/sydney-range";

export const metadata = { title: "From the office · Estate laundry" };
export const dynamic = "force-dynamic";

/**
 * "From the office" (board "Laundry partner portal", 4): photo requests, time
 * confirmations and chases from the office, answered here. Requests are
 * addressed to laundry logins; an office account opening the portal sees
 * that it has none.
 */
export default async function LaundryRequestsPage({ searchParams }: { searchParams?: { task?: string } }) {
  const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const requests = await listOfficeRequestsForLaundryUser(session.user).catch(() => null);
  const initial: OfficeRequestsResponse | null = requests ? { requests, openCount: openRequestCount(requests), windowHours: OFFICE_REQUEST_WINDOW_HOURS } : null;
  const open = initial?.openCount ?? 0;
  return (
    <div className="space-y-4">
      <EPageHeader
        eyebrow="Laundry"
        title="From the office"
        description={initial === null ? "Requests could not be loaded." : open ? `${open} open` : "Nothing open"}
      />
      {session.user.role !== Role.LAUNDRY ? (
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Office requests go to laundry partner logins. This account has none.</p>
      ) : (
        <OfficeRequestsInbox initial={initial} todayKey={sydneyTodayKey()} focusTaskId={typeof searchParams?.task === "string" ? searchParams.task : null} />
      )}
    </div>
  );
}
