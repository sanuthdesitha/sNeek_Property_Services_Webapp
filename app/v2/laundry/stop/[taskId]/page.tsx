import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { filterTasksVisibleToUser, laundryWeekTaskInclude, withHandoffActorNames } from "@/lib/laundry/week-feed";
import { cleanerBagBaseline } from "@/lib/laundry/quantity-baseline";
import { parseRouteStops } from "@/lib/laundry/route-plan";
import { sydneyDayKey } from "@/lib/laundry/route-candidates";
import { StopScreen, type CleanerReport, type StopScreenTask } from "@/components/v2/laundry/portal/stop-screen";

export const metadata = { title: "Stop · Estate laundry" };
export const dynamic = "force-dynamic";

/**
 * One stop of the laundry route (board "Laundry partner portal", 2 Stop):
 * `/v2/laundry/stop/<taskId>?kind=pickup|drop`. The run is read with the same
 * visibility and redaction as the laundry boards (week feed rules); a run this
 * login may not see is "not found". Writes go through the existing status route.
 */
function eventOf(notes: string | null): string | null {
  try {
    const meta = JSON.parse(notes ?? "") as { event?: unknown };
    return typeof meta?.event === "string" ? meta.event : null;
  } catch {
    return null;
  }
}

export default async function LaundryStopPage({ params, searchParams }: { params: { taskId: string }; searchParams?: { kind?: string } }) {
  const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const raw = await db.laundryTask.findUnique({ where: { id: params.taskId }, include: laundryWeekTaskInclude });
  if (!raw) notFound();
  const [task] = await withHandoffActorNames(filterTasksVisibleToUser([raw], session.user.role, session.user.id));
  if (!task) notFound();
  const atLaundry = task.status === "PICKED_UP" || task.status === "READY_TO_RETURN";
  const kind = searchParams?.kind === "drop" || (searchParams?.kind !== "pickup" && atLaundry) ? "DROP" : "PICKUP";

  const settings = await getAppSettings().catch(() => null);
  const zone = settings?.timezone || "Australia/Sydney";
  const handoff = [...task.confirmations].reverse().find((row) => eventOf(row.notes) === null);
  const baseline = cleanerBagBaseline(task.confirmations);
  const cleaner: CleanerReport | null = handoff
    ? { byName: handoff.confirmedByName ?? null, atLabel: formatInTimeZone(handoff.createdAt, zone, "H:mm"), ready: handoff.laundryReady, bagCount: baseline?.count ?? null, location: handoff.bagLocation ?? null, photoUrl: handoff.photoUrl ?? null }
    : null;

  // "Stop 5 of 7 · planned 14:30" from this login's route for today, when the stop is on it.
  const route = await db.laundryRoute.findFirst({ where: { userId: session.user.id, date: sydneyDayKey(), status: { in: ["ACTIVE", "DRAFT"] } }, orderBy: { updatedAt: "desc" } }).catch(() => null);
  const stops = route ? [...parseRouteStops(route.stops)].sort((a, b) => a.order - b.order) : [];
  const index = stops.findIndex((stop) => stop.taskId === task.id && stop.kind === kind);
  const planned = kind === "PICKUP" ? task.pickupTime : task.dropoffTime;
  const stopLabel = [index >= 0 ? `Stop ${index + 1} of ${stops.length}` : "Not on today's route", planned ? `planned ${planned}` : "no planned time"].join(" · ");

  const serialized = JSON.parse(JSON.stringify(task)) as StopScreenTask;
  // Office accounts viewing the portal can open the run's office page (2026-11-14).
  const officeLink = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER
    ? <p className="mb-2 text-[0.8125rem]"><Link className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline" href={`/v2/admin/laundry/runs/${encodeURIComponent(task.id)}`}>Open the office run page</Link></p>
    : null;
  return (
    <>
    {officeLink}
    <StopScreen
      task={serialized}
      kind={kind}
      viewerId={session.user.id}
      stopLabel={stopLabel}
      cleaner={cleaner}
      expected={baseline?.count ?? null}
      baselineId={baseline?.confirmationId ?? null}
      officePhone={settings?.companyPhone || null}
      partnerEntries={session.user.role === Role.LAUNDRY && !session.impersonation}
    />
    </>
  );
}
