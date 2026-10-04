import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { generateJobReport } from "@/lib/reports/generator";

const PREFIX = "qa_report_followups_v1:";
type Followups = { jobId: string; submissionId: string; status: "PENDING" | "RUNNING" | "DONE";
  reportDone: boolean; attempts: number; lease?: string; leasedAt?: string;
  retryAt?: string; failedStages?: string[] };

/** This durable receipt commits with the QA submission. It never submits forms
 * or sends client messages; retries only repair stored report generation. */
export async function enqueueQaReportFollowup(tx: Prisma.TransactionClient, input: { jobId: string; submissionId: string }) {
  const key = `${PREFIX}${input.submissionId}`;
  const value: Followups = { ...input, status: "PENDING", reportDone: false, attempts: 0 };
  await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: {} });
}

export async function processQaReportFollowups(now = new Date(), submissionId?: string) {
  const rows = await db.appSetting.findMany({ where: { key: submissionId ? `${PREFIX}${submissionId}` : { startsWith: PREFIX }, OR: [
    { value: { path: ["status"], equals: "PENDING" } }, { value: { path: ["status"], equals: "RUNNING" } },
  ] }, orderBy: { updatedAt: "asc" }, take: 50, select: { key: true } });
  let completed = 0;
  const reportReadySubmissionIds: string[] = [];
  for (const row of rows) {
    const claimed = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.key}))`;
      const stored = await tx.appSetting.findUnique({ where: { key: row.key } });
      const state = stored?.value as unknown as Followups | undefined;
      if (!state?.jobId || !state.submissionId || state.status === "DONE") return null;
      if (state.status === "RUNNING" && state.leasedAt && now.getTime() - Date.parse(state.leasedAt) < 15 * 60_000) return null;
      if (state.retryAt && Date.parse(state.retryAt) > now.getTime()) return null;
      const next: Followups = { ...state, status: "RUNNING", lease: randomUUID(), leasedAt: now.toISOString(), attempts: (state.attempts ?? 0) + 1 };
      await tx.appSetting.update({ where: { key: row.key }, data: { value: next } });
      return next;
    });
    if (!claimed) continue;
    const failedStages: string[] = [];
    if (!claimed.reportDone) {
      try { await generateJobReport(claimed.jobId); claimed.reportDone = true; }
      catch { failedStages.push("REPORT"); }
    }
    claimed.status = claimed.reportDone ? "DONE" : "PENDING";
    claimed.failedStages = failedStages;
    claimed.retryAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    // An expired worker may finish late. It must not overwrite a newer lease.
    const finalized = await db.appSetting.updateMany({ where: { key: row.key, value: { path: ["lease"], equals: claimed.lease! } }, data: { value: claimed } });
    if (finalized.count === 0) continue;
    if (claimed.status === "DONE") completed += 1;
    if (claimed.reportDone) reportReadySubmissionIds.push(claimed.submissionId);
  }
  return { scanned: rows.length, completed, reportReadySubmissionIds };
}
