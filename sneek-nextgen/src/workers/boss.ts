import { PgBoss } from "pg-boss";

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
  });

  boss.on("error", (error: Error) => {
    console.error("[pg-boss] error:", error);
  });

  await boss.start();

  // ── iCal Sync (every 40 minutes) ──
  await boss.schedule("ical-sync", "*/40 * * * *", {}, { retryLimit: 2, retryDelay: 60 });

  // ── Job Reminders (every 15 minutes) ──
  await boss.schedule("job-reminders", "*/15 * * * *", {}, { retryLimit: 1 });

  // ── Laundry Plan Processing (daily at 6am Sydney) ──
  await boss.schedule("laundry-plan", "0 6 * * *", {}, { retryLimit: 1 });

  // ── Stock Alerts (every hour) ──
  await boss.schedule("stock-alerts", "0 * * * *", {}, { retryLimit: 1 });

  // ── Scheduled Dispatch (every 10 minutes) ──
  await boss.schedule("scheduled-dispatch", "*/10 * * * *", {}, { retryLimit: 1 });

  // ── Web Scheduler (every 5 minutes) ──
  await boss.schedule("web-scheduler", "*/5 * * * *", {}, { retryLimit: 1 });

  // ── Tomorrow Prep (daily at 8pm Sydney) ──
  await boss.schedule("tomorrow-prep", "0 20 * * *", {}, { retryLimit: 1 });

  // ── Safety Checkins (every 30 minutes during business hours) ──
  await boss.schedule("safety-checkins", "*/30 6-22 * * 1-5", {}, { retryLimit: 1 });

  // ── Follow-up Sequences (every hour) ──
  await boss.schedule("follow-up-sequences", "0 * * * *", {}, { retryLimit: 1 });

  // ── Recurring Job Generation (daily at midnight) ──
  await boss.schedule("recurring-jobs", "0 0 * * *", {}, { retryLimit: 1 });

  // ── Daily Briefing (daily at 7am Sydney) ──
  await boss.schedule("daily-briefing", "0 7 * * *", {}, { retryLimit: 1 });

  // ── Client Automation Triggers (every 10 minutes) ──
  await boss.schedule("client-automation", "*/10 * * * *", {}, { retryLimit: 1 });

  // ── Auto Clockout (every 5 minutes) ──
  await boss.schedule("auto-clockout", "*/5 * * * *", {}, { retryLimit: 1 });

  // ── Report Generation (non-blocking queue) ──
  await boss.schedule("report-generation", "*/5 * * * *", {}, { retryLimit: 2 });

  // ── Invoice Generation (every 15 minutes) ──
  await boss.schedule("invoice-generation", "*/15 * * * *", {}, { retryLimit: 2 });

  // ── Notification Rule Evaluation (every 10 minutes) ──
  await boss.schedule("notification-rules", "*/10 * * * *", {}, { retryLimit: 1 });

  // ── Data Cleanup (weekly, Sunday 3am) ──
  await boss.schedule("data-cleanup", "0 3 * * 0", {}, { retryLimit: 1 });

  return boss;
}

export async function sendJob(
  queueName: string,
  data: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<string | null> {
  const b = await getBoss();
  return b.send(queueName, data, options);
}

export async function stopBoss(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
