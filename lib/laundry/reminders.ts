/**
 * Laundry reminder selectors + the 15:00 driver-nudge dispatcher.
 *
 * The selectors are PURE (unit-tested in tests/lib/laundry-reminders.test.ts):
 *  - selectStaleDriverTasks: what a driver should be chased about at 15:00 —
 *    due today but still PENDING/CONFIRMED, or PICKED_UP for > 24h.
 *  - selectAdminAttentionTasks: tasks (not DROPPED/SKIPPED) untouched > 48h,
 *    for the admin attention summary's laundry section.
 *
 * dispatchLaundryDriverNudges is the impure half wired into the web scheduler
 * (`laundry-driver-nudge`, daily hour 15 Sydney): per-driver push (web + mobile
 * — mobile piggybacks on the Notification PUSH row via the db extension) and a
 * sweep that ABANDONs ACTIVE routes left over from previous days.
 */
import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { propertyIsVisibleToLaundry } from "@/lib/laundry/teams";
import { sendWebPushToUser } from "@/lib/notifications/web-push";

const TZ = "Australia/Sydney";
const PICKED_UP_STALE_MS = 24 * 60 * 60 * 1000;
const ADMIN_STALE_MS = 48 * 60 * 60 * 1000;

export type ReminderTask = {
  id: string;
  status: string;
  pickupDate: Date | string;
  dropoffDate: Date | string;
  pickedUpAt?: Date | string | null;
  updatedAt: Date | string;
  noPickupRequired?: boolean | null;
  property?: { name?: string | null; suburb?: string | null } | null;
};

function isSameSydneyDay(value: Date | string, now: Date): boolean {
  const a = toZonedTime(new Date(value), TZ);
  const b = toZonedTime(now, TZ);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Tasks a driver should be nudged about (caller runs this in an after-15:00
 * Sydney context): due today and still PENDING/CONFIRMED, or sitting PICKED_UP
 * with pickedUpAt more than 24h ago.
 */
export function selectStaleDriverTasks<T extends ReminderTask>(tasks: T[], now: Date): T[] {
  return tasks.filter((task) => {
    if (["PENDING", "CONFIRMED"].includes(task.status)) {
      const pickupDueToday = !task.noPickupRequired && isSameSydneyDay(task.pickupDate, now);
      const dropDueToday = isSameSydneyDay(task.dropoffDate, now);
      return pickupDueToday || dropDueToday;
    }
    if (task.status === "PICKED_UP" && task.pickedUpAt) {
      return now.getTime() - new Date(task.pickedUpAt).getTime() > PICKED_UP_STALE_MS;
    }
    return false;
  });
}

/** Tasks not DROPPED/SKIPPED whose last update is more than 48h old. */
export function selectAdminAttentionTasks<T extends ReminderTask>(tasks: T[], now: Date): T[] {
  return tasks.filter(
    (task) =>
      !["DROPPED", "SKIPPED_PICKUP"].includes(task.status) &&
      now.getTime() - new Date(task.updatedAt).getTime() > ADMIN_STALE_MS,
  );
}

function summarizeTasks(tasks: ReminderTask[]): string {
  const names = tasks
    .slice(0, 4)
    .map((t) => t.property?.name ?? "a property")
    .join(", ");
  const extra = tasks.length > 4 ? ` +${tasks.length - 4} more` : "";
  return `${names}${extra}`;
}

/** UTC-midnight key for today's Sydney calendar day (route.date convention). */
export function sydneyTodayUtcKey(now = new Date()): Date {
  const zoned = toZonedTime(now, TZ);
  return new Date(Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()));
}

export async function dispatchLaundryDriverNudges(now = new Date()) {
  const todayKey = sydneyTodayUtcKey(now);

  // Sweep: ACTIVE routes from previous days can never complete — ABANDON them.
  const abandoned = await db.laundryRoute.updateMany({
    where: { status: "ACTIVE", date: { lt: todayKey } },
    data: { status: "ABANDONED", endedAt: now },
  });

  // Candidate tasks: anything possibly stale — due today (either leg) or still
  // PICKED_UP. The pure selector applies the real rules per driver.
  const dayEnd = new Date(todayKey.getTime() + 86_400_000);
  const tasks = await db.laundryTask.findMany({
    where: {
      OR: [
        { pickupDate: { gte: todayKey, lt: dayEnd }, status: { in: ["PENDING", "CONFIRMED"] } },
        { dropoffDate: { gte: todayKey, lt: dayEnd }, status: { in: ["PENDING", "CONFIRMED"] } },
        { status: "PICKED_UP" },
      ],
    },
    select: {
      id: true,
      status: true,
      pickupDate: true,
      dropoffDate: true,
      pickedUpAt: true,
      updatedAt: true,
      noPickupRequired: true,
      property: {
        select: { name: true, suburb: true, accessInfo: true, laundryEnabled: true },
      },
    },
  });

  const drivers = await db.user.findMany({
    where: { role: "LAUNDRY", isActive: true },
    select: { id: true, name: true },
  });

  let nudged = 0;
  for (const driver of drivers) {
    const visible = tasks.filter((t) => propertyIsVisibleToLaundry(t.property, driver.id));
    const stale = selectStaleDriverTasks(visible, now);
    if (stale.length === 0) continue;

    const body = `${stale.length} laundry task${stale.length === 1 ? "" : "s"} need${
      stale.length === 1 ? "s" : ""
    } action: ${summarizeTasks(stale)}. Open Today to catch up before end of day.`;
    try {
      await db.notification.create({
        data: {
          userId: driver.id,
          channel: NotificationChannel.PUSH,
          subject: "Laundry catch-up",
          body,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
      await sendWebPushToUser(driver.id, {
        title: "Laundry catch-up",
        body,
        url: "/v2/laundry",
        tag: "laundry-driver-nudge",
      });
      nudged += 1;
    } catch (err) {
      logger.error({ err, userId: driver.id }, "[laundry-reminders] driver nudge failed");
    }
  }

  logger.info(
    { nudged, drivers: drivers.length, abandonedRoutes: abandoned.count },
    "[laundry-reminders] driver nudge run complete",
  );
  return { nudged, abandonedRoutes: abandoned.count };
}
