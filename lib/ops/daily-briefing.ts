import { addDays, format, subHours } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

const STATE_KEY = "daily_ops_briefing_dispatch_v1";
const TZ = "Australia/Sydney";

function localDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function readDispatchState() {
  const row = await db.appSetting.findUnique({ where: { key: STATE_KEY } });
  const value = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as Record<string, unknown>) : {};
  return typeof value.lastDate === "string" ? value.lastDate : "";
}

async function writeDispatchState(lastDate: string) {
  await db.appSetting.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value: { lastDate } as any },
    update: { value: { lastDate } as any },
  });
}

export async function sendDailyOpsBriefing(now = new Date()) {
  const settings = await getAppSettings();
  const todayKey = localDateKey(now);
  const lastDate = await readDispatchState();
  if (lastDate === todayKey) {
    return { sent: 0, skipped: ["Already sent today."] };
  }

  // Sydney local midnight, not UTC midnight — otherwise "today's jobs" is
  // shifted ~10-11h and includes/excludes the wrong evening jobs.
  const todayStart = fromZonedTime(`${todayKey}T00:00:00`, TZ);
  const todayEnd = addDays(todayStart, 1);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const docCutoff = addDays(now, 14);

  const [todayJobs, unassignedJobs, laundryPickups, openCases, newLeads, expiringDocs, admins] = await Promise.all([
    db.job.findMany({
      // Cancelled jobs are not today's work (Wave E).
      where: { scheduledDate: { gte: todayStart, lt: todayEnd }, status: { not: "CANCELLED" } },
      select: { status: true },
    }),
    db.job.count({ where: { status: "UNASSIGNED", scheduledDate: { gte: todayStart, lt: todayEnd } } }),
    db.laundryTask.count({ where: { voidedAt: null, pickupDate: { gte: todayStart, lt: todayEnd } } }),
    db.issueTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, createdAt: { lte: fortyEightHoursAgo } } }),
    db.quoteLead.count({ where: { createdAt: { gte: subHours(now, 24) } } }),
    // Include ALREADY-EXPIRED docs, not just upcoming ones — a lapsed police
    // check / visa is the most urgent case and was previously hidden by the
    // `gte: now` lower bound. (Null expiresAt never matches lte, so "no expiry"
    // docs stay excluded.)
    db.staffDocument.count({ where: { expiresAt: { lte: docCutoff } } }),
    db.user.findMany({ where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true }, select: { email: true, name: true } }),
  ]);

  const byStatus = todayJobs.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const wording = await loadNotificationWording("office.sla_and_summaries");
  const briefing = wording.render("daily-briefing", "EMAIL", {
    date: format(now, "dd MMM yyyy"),
    dateLabel: format(now, "EEEE, dd MMM yyyy"),
    jobsToday: todayJobs.length,
    unassignedToday: unassignedJobs,
    laundryPickups,
    openCases,
    newLeads,
    expiringDocs,
    statusMix: Object.entries(byStatus).map(([status, count]) => `${status.replace(/_/g, " ")}: ${count}`).join(" | ") || wording.line("no-jobs", "EMAIL", {}),
  });
  const html = briefing.html;

  let sent = 0;
  for (const admin of admins) {
    if (!admin.email) continue;
    const result = await sendEmailDetailed({ kind: "daily_briefing",
      to: admin.email,
      subject: briefing.subject,
      html,
      replyTo: settings.accountsEmail || undefined,
    });
    if (result.ok) sent += 1;
  }

  await writeDispatchState(todayKey);
  return { sent, todayJobs: todayJobs.length, unassignedJobs, laundryPickups, openCases, newLeads, expiringDocs, skipped: [] as string[] };
}
