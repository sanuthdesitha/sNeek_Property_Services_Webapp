/**
 * pg-boss worker entry point.
 * Run with: tsx workers/boss.ts
 */

import PgBoss from "pg-boss";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { syncAllIcal } from "@/lib/ical/sync";
import { buildLaundryPlanDraft } from "@/lib/laundry/planner";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/notifications/email";
import { sendSms } from "@/lib/notifications/sms";
import { generateRecurringJobs } from "@/lib/ops/recurring";
import { runSlaEscalation } from "@/lib/ops/sla";
import { generateJobReport } from "@/lib/reports/generator";
import { getAppSettings } from "@/lib/settings";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { resolveAppUrl } from "@/lib/app-url";

const TZ = "Australia/Sydney";
const DATABASE_URL = process.env.DATABASE_URL!;

async function main() {
  const boss = new PgBoss(DATABASE_URL);

  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

  await boss.start();
  logger.info("pg-boss started");

  await boss.schedule("ical-sync", "*/40 * * * *", {});
  await boss.work("ical-sync", async () => {
    logger.info("Running iCal sync");
    await syncAllIcal();
  });

  await boss.schedule("reminder-dispatch", "*/5 * * * *", {});
  await boss.work<{ jobId?: string }>("reminder-dispatch", async () => {
    await dispatchReminders();
  });

  await boss.schedule("weekly-laundry-plan", "0 9 * * 1", {});
  await boss.work("weekly-laundry-plan", async () => {
    logger.info("Preparing weekly laundry draft");
    const now = toZonedTime(new Date(), TZ);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const draft = await buildLaundryPlanDraft(monday);
    logger.info(
      { count: draft.length },
      "Weekly laundry draft calculated. Manual approval in the admin laundry planner is required before tasks go live."
    );
  });

  await boss.schedule("stock-alerts", "0 7 * * *", {});
  await boss.work("stock-alerts", async () => {
    await sendStockAlerts();
  });

  await boss.schedule("sla-escalation", "*/15 * * * *", {});
  await boss.work("sla-escalation", async () => {
    const result = await runSlaEscalation(new Date());
    if (result.warned > 0 || result.escalated > 0) {
      logger.warn({ ...result }, "SLA escalation run");
    }
  });

  await boss.schedule("recurring-job-generate", "5 0 * * *", {});
  await boss.work("recurring-job-generate", async () => {
    const settings = await getAppSettings();
    if (!settings.recurringJobs.enabled) return;
    const startDate = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + settings.recurringJobs.lookaheadDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const result = await generateRecurringJobs({ startDate, endDate });
    if (result.created > 0) {
      logger.info({ ...result, startDate, endDate }, "Recurring jobs generated");
    }
  });

  await boss.work<{ jobId: string }>("report-generate", async (job) => {
    if (!job?.data?.jobId) return;
    logger.info({ jobId: job.data.jobId }, "Generating report");
    await generateJobReport(job.data.jobId);
  });

  logger.info("All workers registered. Listening for jobs.");
}

async function dispatchReminders() {
  const now = new Date();
  const settings = await getAppSettings();

  const longWindowHours = Math.max(1, settings.reminder24hHours);
  const shortWindowHours = Math.max(1, settings.reminder2hHours);

  const longEnd = new Date(now.getTime() + longWindowHours * 3600_000);
  const longStart = new Date(now.getTime() + (longWindowHours - 1) * 3600_000);

  const jobsLong = await db.job.findMany({
    where: {
      scheduledDate: { gte: longStart, lte: longEnd },
      status: { in: ["ASSIGNED"] },
      reminder24hSent: false,
    },
    select: {
      id: true,
      jobType: true,
      startTime: true,
      internalNotes: true,
      property: { select: { name: true, address: true } },
      assignments: { select: { user: { select: { name: true, email: true, phone: true } } } },
    },
  });

  for (const job of jobsLong) {
    const timingText = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ");
    const timingHtml = timingText ? `<p><strong>Timing:</strong> ${timingText}</p>` : "";
    for (const assignment of job.assignments) {
      if (!assignment.user.email) continue;
      await sendEmail({
        to: assignment.user.email,
        subject: `Reminder: Cleaning job soon - ${job.property.name}`,
        html: `<p>Hi ${assignment.user.name},</p><p>You have a ${job.jobType.replace(
          /_/g,
          " "
        )} job coming up at <strong>${job.property.name}</strong>, ${job.property.address}.</p><p>Start time: ${
          job.startTime ?? "TBD"
        }</p>${timingHtml}`,
      });
    }
    await db.job.update({ where: { id: job.id }, data: { reminder24hSent: true } });
    logger.info({ jobId: job.id }, "Long-window reminder sent");
  }

  const shortEnd = new Date(now.getTime() + shortWindowHours * 3600_000);
  const shortStart = new Date(now.getTime() + (shortWindowHours - 1) * 3600_000);

  const jobsShort = await db.job.findMany({
    where: {
      scheduledDate: { gte: shortStart, lte: shortEnd },
      status: { in: ["ASSIGNED"] },
      reminder2hSent: false,
    },
    select: {
      id: true,
      jobType: true,
      startTime: true,
      internalNotes: true,
      property: { select: { name: true, address: true } },
      assignments: { select: { user: { select: { name: true, email: true, phone: true } } } },
    },
  });

  for (const job of jobsShort) {
    const timingText = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ");
    const timingSuffix = timingText ? ` ${timingText}.` : "";
    for (const assignment of job.assignments) {
      if (!assignment.user.phone) continue;
      await sendSms(
        assignment.user.phone,
        `sNeek Ops: Your cleaning job at ${job.property.name} starts soon (${job.startTime ?? "today"}). ${
          job.property.address
        }.${timingSuffix}`
      );
    }
    await db.job.update({ where: { id: job.id }, data: { reminder2hSent: true } });
    logger.info({ jobId: job.id }, "Short-window reminder sent");
  }
}

async function sendStockAlerts() {
  const lowStocks = await db.propertyStock.findMany({
    where: { onHand: { lte: db.propertyStock.fields.reorderThreshold } },
    include: {
      item: true,
      property: { include: { client: true } },
    },
  });

  if (lowStocks.length === 0) return;

  const adminUsers = await db.user.findMany({ where: { role: "ADMIN", isActive: true } });
  const lines = lowStocks
    .map(
      (stock) =>
        `- ${stock.property.name} - ${stock.item.name}: ${stock.onHand} ${stock.item.unit} on hand (par: ${stock.parLevel})`
    )
    .join("\n");

  for (const admin of adminUsers) {
    if (!admin.email) continue;
    const inventoryUrl = resolveAppUrl("/admin/inventory");
    const inventoryLink = /^https?:\/\//i.test(inventoryUrl)
      ? `<p><a href="${inventoryUrl}">View shopping list</a></p>`
      : "";
    await sendEmail({
      to: admin.email,
      subject: `sNeek Ops: ${lowStocks.length} items low on stock`,
      html: `<p>${lowStocks.length} items are below reorder threshold:</p><pre>${lines}</pre>${inventoryLink}`,
    });
  }

  logger.info({ count: lowStocks.length }, "Stock alerts sent");
}

main().catch((err) => {
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});
