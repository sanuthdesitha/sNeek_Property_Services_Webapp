import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureQaAssignmentForCompletedJob } from "@/lib/qa/auto-assignment";
import { generateJobReport } from "@/lib/reports/generator";

import type { LowStockRow } from "@/lib/inventory/stock";
import { reconcileSubmissionLowStock, queueLowStockReview } from "./submission-low-stock";

const PREFIX = "cleaner_submission_followups_v1:";
type Followups = { jobId: string; submissionId: string; status: "PENDING" | "RUNNING" | "DONE";
  propertyId?: string; lowStockRows?: LowStockRow[]; lowStockDone?: boolean; qaDone: boolean; reportDone: boolean; attempts: number; lease?: string; leasedAt?: string;
  retryAt?: string; failedStages?: string[] };

/** This durable receipt commits with the submitted form. It never submits forms
 * or sends client messages; retries repair internal QA/report scaffolding and reconcile restocking through the notification outbox. */
export async function enqueueSubmissionFollowups(tx: Prisma.TransactionClient, input: { jobId: string; submissionId: string; propertyId?: string; lowStockRows?: LowStockRow[] }) {
  const key = `${PREFIX}${input.submissionId}`;
  const value: Followups = { ...input, status: "PENDING", lowStockDone: !input.lowStockRows?.length, qaDone: false, reportDone: false, attempts: 0 };
  await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: {} });
}

export async function processSubmissionFollowups(now = new Date(), submissionId?: string) {
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
    if (!claimed.qaDone) {
      try { await ensureQaAssignmentForCompletedJob(claimed.jobId); claimed.qaDone = true; }
      catch { failedStages.push("QA_ASSIGNMENT"); }
    }
    if (!claimed.reportDone) {
      try { await generateJobReport(claimed.jobId); claimed.reportDone = true; }
      catch { failedStages.push("REPORT"); }
    }
    if (!claimed.lowStockDone && claimed.lowStockRows?.length) {
      try {
        if (!claimed.propertyId) throw new Error("LOW_STOCK_PROPERTY_MISSING");
        await reconcileSubmissionLowStock({ jobId: claimed.jobId, submissionId: claimed.submissionId, propertyId: claimed.propertyId, lowStockRows: claimed.lowStockRows });
        claimed.lowStockDone = true;
      } catch {
        failedStages.push("LOW_STOCK");
        try { await queueLowStockReview(claimed); } catch { failedStages.push("LOW_STOCK_REVIEW_NOTICE"); }
      }
    }
    claimed.status = claimed.qaDone && claimed.reportDone && (!claimed.lowStockRows?.length || claimed.lowStockDone) ? "DONE" : "PENDING";
    claimed.failedStages = failedStages;
    claimed.retryAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    // An expired worker may finish late. It must not overwrite a newer lease.
    const finished = await db.appSetting.updateMany({ where: { key: row.key, value: { path: ["lease"], equals: claimed.lease! } }, data: { value: claimed } });
    if (finished.count !== 1) continue;
    if (claimed.status === "DONE") completed += 1;
    if (claimed.reportDone) reportReadySubmissionIds.push(claimed.submissionId);
  }
  return { scanned: rows.length, completed, reportReadySubmissionIds };
}
