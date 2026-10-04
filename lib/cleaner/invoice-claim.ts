import { db } from "@/lib/db";
import { assertHolidayRateSnapshots } from "@/lib/finance/holiday-rates";
import { issueInvoiceNumber } from "@/lib/billing/invoice-sequence";
import { markCleanerShoppingRunsInvoiced, stampShoppingSettlementsForCleanerInvoice } from "@/lib/inventory/shopping-runs";
import { qaAssignmentPayeeWhere } from "@/lib/qa/ownership";
import type { CleanerInvoiceData } from "@/lib/cleaner/invoice";

/** A durable local receipt and every payable claim commit before external delivery. */
export async function claimCleanerInvoice(input: { cleanerId: string; requestId?: string; data: CleanerInvoiceData; lineData: any }) {
  const { cleanerId, data, lineData } = input;
  return db.$transaction(async tx => {
    // Shared with payroll-run creation. Stable order for multi-payee payroll.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cleanerId}))`;
    const previous = await tx.cleanerInvoiceSubmission.findMany({
      where: { cleanerId, status: { notIn: ["VOID", "CHANGES_REQUESTED"] } },
      select: { id: true, invoiceNumber: true, status: true, lineData: true, periodStart: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const retry = previous.find(row => (input.requestId && (row.lineData as any)?.requestId === input.requestId) || row.status === "SENDING");
    if (retry) return { ...retry, reused: true };
    if (data.rows.length + data.extraLineRows.length + data.qaInspectionRows.length + data.expenseRows.length + data.shoppingTimeRows.length === 0) throw new Error("No uninvoiced work remains. Review your submitted invoices.");
    const ids = Array.from(new Set(data.rows.map(row => row.jobId))).sort();
    await assertHolidayRateSnapshots(tx, ids);
    const priorJobs = new Set(previous.flatMap(row => Array.isArray((row.lineData as any)?.jobIds) ? (row.lineData as any).jobIds as string[] : []));
    if (ids.some(id => priorJobs.has(id))) throw new Error("Invoice work changed. Refresh before submitting.");
    for (const id of ids) await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${id} FOR UPDATE`;
    if (ids.length && await tx.job.count({ where: { id: { in: ids },
      ...(data.claimVersions ? { OR: ids.map(id => ({ id, updatedAt: new Date(data.claimVersions!.jobs[id] ?? "invalid") })) } : {}), payrollRunId: null, status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] }, cleanSkipStatus: { not: "SKIPPED" }, assignments: { some: { userId: cleanerId, removedAt: null } } } }) !== ids.length) {
      throw new Error("Some jobs were reassigned or claimed by payroll. Refresh before submitting.");
    }
    const created = await tx.cleanerInvoiceSubmission.create({
      data: { cleanerId, invoiceNumber: await issueInvoiceNumber("CLEANER"), periodStart: data.start, periodEnd: data.end,
        hours: data.hours, totalAmount: data.estimatedPay, jobCount: data.rows.length, status: "SENDING",
        lineData: { ...lineData, requestId: input.requestId ?? null, delivery: "PENDING" } },
      select: { id: true, invoiceNumber: true, status: true },
    });
    const adjustmentIds = Array.from(new Set(data.includedAdjustmentIds));
    for (const id of adjustmentIds) {
      const claim = await tx.cleanerPayAdjustment.updateMany({
        where: { id, cleanerId, status: "APPROVED", includedInPayrollRunId: null, includedInCleanerInvoiceId: null,
          ...(data.claimVersions ? { updatedAt: new Date(data.claimVersions.adjustments[id] ?? "invalid") } : {}) },
        data: { includedInCleanerInvoiceId: created.id, includedInCleanerInvoiceAt: new Date() },
      });
      if (claim.count !== 1) throw new Error("Extra pay was already claimed or changed. Refresh before submitting.");
    }
    for (const row of data.qaInspectionRows) {
      const claim = await tx.qaAssignment.updateMany({ where: { id: row.assignmentId, status: "COMPLETED",
        ...(data.claimVersions ? { updatedAt: new Date(data.claimVersions.qa[row.assignmentId] ?? "invalid") } : {}), ...qaAssignmentPayeeWhere(cleanerId), includedInPayrollRunId: null, includedInCleanerInvoiceId: null },
        data: { includedInCleanerInvoiceId: created.id, includedInCleanerInvoiceAt: new Date(), paySettledAmount: row.amount } });
      if (claim.count !== 1) throw new Error("Inspection pay was already claimed. Refresh before submitting.");
    }
    const runIds = Array.from(new Set([...data.expenseRows, ...data.shoppingTimeRows].map(row => row.runId))).sort();
    for (const id of runIds) await tx.$queryRaw`SELECT "id" FROM "ShoppingRun" WHERE "id" = ${id} FOR UPDATE`;
    if (runIds.length) {
      if (data.claimVersions && await tx.shoppingRun.count({ where: { OR: runIds.map(id => ({ id, updatedAt: new Date(data.claimVersions!.shopping[id] ?? "invalid") })) } }) !== runIds.length) {
        throw new Error("Shopping amounts changed. Refresh before submitting.");
      }
      const owned = await markCleanerShoppingRunsInvoiced({ cleanerId, runIds }, tx);
      await stampShoppingSettlementsForCleanerInvoice({ ownedRunIds: owned, invoiceId: created.id, requireAll: true,
        expense: data.expenseRows.map(row => ({ runId: row.runId, amount: row.amount })),
        time: data.shoppingTimeRows.map(row => ({ runId: row.runId, amount: row.amount })) }, tx);
    }
    const days = Array.from(new Set(data.claimableAllowanceDays ?? []));
    if (days.length) {
      await tx.qaDayAllowance.createMany({ data: days.map(day => ({ inspectorId: cleanerId, day: new Date(`${day}T00:00:00.000Z`), amount: data.transportAllowanceRows.find(row => row.day === day)?.amount ?? 0 })), skipDuplicates: true });
      const claim = await tx.qaDayAllowance.updateMany({ where: { inspectorId: cleanerId, day: { in: days.map(day => new Date(`${day}T00:00:00.000Z`)) }, includedInPayrollRunId: null, includedInCleanerInvoiceId: null }, data: { includedInCleanerInvoiceId: created.id } });
      if (claim.count !== days.length) throw new Error("Travel allowance was already claimed. Refresh before submitting.");
    }
    return { ...created, reused: false };
  });
}
