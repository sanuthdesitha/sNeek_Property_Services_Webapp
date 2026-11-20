import "server-only";
/**
 * The device charge line on the cleaner's clean notices (2026-11-20): the
 * combined reminder emails list "High priority: <task title>" under each job
 * that carries an open device charge task. Read-only.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { DEVICE_CHARGE_TASK_KIND } from "./types";

export async function deviceChargeLinesForJobs(jobIds: readonly string[]): Promise<Map<string, string[]>> {
  const lines = new Map<string, string[]>();
  if (jobIds.length === 0) return lines;
  // The reminder still goes out if this lookup fails; the line is then missing, and that is logged.
  const tasks = await db.jobTask.findMany({
    where: { jobId: { in: [...jobIds] }, executionStatus: "OPEN", visibleToCleaner: true, metadata: { path: ["kind"], equals: DEVICE_CHARGE_TASK_KIND } },
    select: { jobId: true, title: true },
    orderBy: { createdAt: "asc" },
  }).catch((err: unknown) => {
    logger.error({ err }, "property devices: charge lines for reminders could not be read");
    return [] as Array<{ jobId: string | null; title: string }>;
  });
  for (const task of tasks) {
    if (!task.jobId) continue;
    lines.set(task.jobId, [...(lines.get(task.jobId) ?? []), `High priority: ${task.title}`]);
  }
  return lines;
}
