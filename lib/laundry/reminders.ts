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
import { mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { canDeliverNotification } from "@/lib/notifications/preferences";
import { getAppSettings } from "@/lib/settings";
import { isChannelAllowed } from "@/lib/notifications/audience-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { isAtLaundryStatus } from "./status-groups";
import { LAUNDRY_ADMIN_ATTENTION_STALE_HOURS, LAUNDRY_PICKED_UP_STALE_HOURS } from "@/lib/scheduling-rules/constants";

const TZ = "Australia/Sydney";
const PICKED_UP_STALE_MS = LAUNDRY_PICKED_UP_STALE_HOURS * 60 * 60 * 1000;
const ADMIN_STALE_MS = LAUNDRY_ADMIN_ATTENTION_STALE_HOURS * 60 * 60 * 1000;

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
export function selectStaleDriverTasks<T extends ReminderTask>(tasks: T[], now: Date, pickedUpStaleMs: number = PICKED_UP_STALE_MS): T[] {
  return tasks.filter((task) => {
    if (["PENDING", "CONFIRMED"].includes(task.status)) {
      const pickupDueToday = !task.noPickupRequired && isSameSydneyDay(task.pickupDate, now);
      const dropDueToday = isSameSydneyDay(task.dropoffDate, now);
      return pickupDueToday || dropDueToday;
    }
    // "Ready to return" sets are still out of the property, like PICKED_UP.
    if (isAtLaundryStatus(task.status) && task.pickedUpAt) {
      return now.getTime() - new Date(task.pickedUpAt).getTime() > pickedUpStaleMs;
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

/**
 * `rules` comes from the published scheduling rules (the worker passes the
 * live version); without it the original 24-hour threshold applies.
 */
export async function dispatchLaundryDriverNudges(now = new Date(), rules?: { laundryPickedUpStaleHours: number }) {
  const pickedUpStaleMs = rules ? rules.laundryPickedUpStaleHours * 60 * 60 * 1000 : PICKED_UP_STALE_MS;
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
        { status: { in: ["PICKED_UP", "READY_TO_RETURN"] } },
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

  const settings = await getAppSettings();
  let nudged = 0;
  for (const driver of drivers) {
    const visible = tasks.filter((t) => propertyIsVisibleToLaundry(t.property, driver.id));
    const stale = selectStaleDriverTasks(visible, now, pickedUpStaleMs);
    if (stale.length === 0) continue;
    if (!isChannelAllowed(settings.notificationAudienceControls, "LAUNDRY", "push") ||
      !await canDeliverNotification({ userId: driver.id, category: "laundry", channel: "WEB" })) continue;

    const catchUp = (await loadNotificationWording("laundry.updates")).render("catch-up", "INBOX", {
      count: stale.length,
      taskWord: stale.length === 1 ? "task" : "tasks",
      needWord: stale.length === 1 ? "needs" : "need",
      tasks: summarizeTasks(stale),
    });
    const body = catchUp.body;
    try {
      await db.notification.create({
        data: {
          // A stable primary key makes retries/concurrent schedulers no-ops.
          id: `laundry-nudge:${todayKey.toISOString().slice(0, 10)}:${driver.id}`,
          externalId: mobilePendingMarker("laundry"),
          userId: driver.id,
          channel: NotificationChannel.PUSH,
          subject: catchUp.title,
          body,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
      await sendWebPushToUser(driver.id, {
        title: catchUp.title,
        body,
        url: "/v2/laundry",
        tag: "laundry-driver-nudge",
      });
      nudged += 1;
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002") continue;
      logger.error({ err, userId: driver.id }, "[laundry-reminders] driver nudge failed");
    }
  }

  logger.info(
    { nudged, drivers: drivers.length, abandonedRoutes: abandoned.count },
    "[laundry-reminders] driver nudge run complete",
  );
  return { nudged, abandonedRoutes: abandoned.count };
}
