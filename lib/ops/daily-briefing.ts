import { addDays, format, subHours } from "date-fns";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";

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

  const todayStart = new Date(`${todayKey}T00:00:00.000Z`);
  const todayEnd = addDays(todayStart, 1);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const docCutoff = addDays(now, 14);

  const [todayJobs, unassignedJobs, laundryPickups, openCases, newLeads, expiringDocs, admins] = await Promise.all([
    db.job.findMany({
      where: { scheduledDate: { gte: todayStart, lt: todayEnd } },
      select: { status: true },
    }),
    db.job.count({ where: { status: "UNASSIGNED", scheduledDate: { gte: todayStart, lt: todayEnd } } }),
    db.laundryTask.count({ where: { pickupDate: { gte: todayStart, lt: todayEnd } } }),
    db.issueTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, createdAt: { lte: fortyEightHoursAgo } } }),
    db.quoteLead.count({ where: { createdAt: { gte: subHours(now, 24) } } }),
    db.staffDocument.count({ where: { expiresAt: { gte: now, lte: docCutoff } } }),
    db.user.findMany({ where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true }, select: { email: true, name: true } }),
  ]);

  const byStatus = todayJobs.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const html = `
    <h2 style="margin:0 0 12px;">Morning ops briefing</h2>
    <p>${format(now, "EEEE, dd MMM yyyy")}</p>
    <ul style="margin:16px 0;padding-left:20px;line-height:1.7;">
      <li><strong>${todayJobs.length}</strong> jobs scheduled today</li>
      <li><strong>${unassignedJobs}</strong> unassigned jobs today</li>
      <li><strong>${laundryPickups}</strong> laundry pickups today</li>
      <li><strong>${openCases}</strong> cases open for more than 48 hours</li>
      <li><strong>${newLeads}</strong> new leads in the last 24 hours</li>
      <li><strong>${expiringDocs}</strong> staff documents expiring within 14 days</li>
    </ul>
    <p>Status mix: ${Object.entries(byStatus).map(([status, count]) => `${status.replace(/_/g, " ")}: ${count}`).join(" | ") || "No jobs"}</p>
  `;

  let sent = 0;
  for (const admin of admins) {
    if (!admin.email) continue;
    const result = await sendEmailDetailed({
      to: admin.email,
      subject: `sNeek ops briefing - ${format(now, "dd MMM yyyy")}`,
      html,
      replyTo: settings.accountsEmail || undefined,
    });
    if (result.ok) sent += 1;
  }

  await writeDispatchState(todayKey);
  return { sent, todayJobs: todayJobs.length, unassignedJobs, laundryPickups, openCases, newLeads, expiringDocs, skipped: [] as string[] };
}
