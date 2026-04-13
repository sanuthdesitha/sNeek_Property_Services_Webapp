import { db } from "@/lib/db";
import { PayrollRunStatus, PayoutStatus, PayoutMethod, Role, PayAdjustmentStatus } from "@prisma/client";
import { getPayrollSummary } from "@/lib/finance/payroll";

export interface PayrollRunDetail {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  status: PayrollRunStatus;
  totalPayable: number;
  totalShoppingReimbursements: number;
  totalTransportAllowances: number;
  totalAdjustments: number;
  grandTotal: number;
  cleanerCount: number;
  createdAt: Date;
  confirmedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  payouts: PayoutDetail[];
}

export interface PayoutDetail {
  id: string;
  cleanerId: string;
  cleanerName: string | null;
  cleanerEmail: string;
  amount: number;
  shoppingReimbursement: number;
  transportAllowance: number;
  adjustments: number;
  status: PayoutStatus;
  method: PayoutMethod;
  bankBsb: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  stripeAccountId: string | null;
  failureReason: string | null;
}

/**
 * Create a new payroll run from a date range.
 * Calculates all cleaner pay from jobs, adjustments, shopping reimbursements, and transport allowances.
 */
export async function createPayrollRun(input: { periodStart: string; periodEnd: string; notes?: string; createdByUserId: string }) {
  const summary = await getPayrollSummary({ startDate: input.periodStart, endDate: input.periodEnd });

  // Filter to cleaners with actual pay
  const payableCleaners = summary.filter((c) => c.totals.grossPay > 0);

  if (payableCleaners.length === 0) {
    throw new Error("No payable cleaners found for this date range. Ensure jobs are submitted and adjustments are approved.");
  }

  const grandTotal = payableCleaners.reduce((sum, c) => sum + c.totals.grossPay, 0);
  const totalShopping = payableCleaners.reduce((sum, c) => sum + c.totals.shoppingReimbursements, 0);
  const totalTransport = payableCleaners.reduce((sum, c) =>
    sum + c.jobs.reduce((jSum, j) => jSum + (j.transportAllowance ?? 0), 0), 0);
  const totalAdjustments = payableCleaners.reduce((sum, c) => sum + c.totals.adjustments, 0);

  const run = await db.payrollRun.create({
    data: {
      periodStart: new Date(`${input.periodStart}T00:00:00+10:00`),
      periodEnd: new Date(`${input.periodEnd}T23:59:59+10:00`),
      status: PayrollRunStatus.DRAFT,
      totalPayable: payableCleaners.reduce((sum, c) => sum + c.totals.jobGross, 0),
      totalShoppingReimbursements: totalShopping,
      totalTransportAllowances: totalTransport,
      totalAdjustments: totalAdjustments,
      grandTotal,
      cleanerCount: payableCleaners.length,
      createdByUserId: input.createdByUserId,
      notes: input.notes ?? null,
    },
  });

  // Fetch full user data including bank details for each payable cleaner
  const cleanerIds = payableCleaners.map((c) => c.cleaner.id);
  const fullUsers = await db.user.findMany({
    where: { id: { in: cleanerIds } },
    select: {
      id: true, name: true, email: true, hourlyRate: true,
      bankBsb: true, bankAccountNumber: true, bankAccountName: true, stripeAccountId: true,
    },
  });
  const userMap = new Map(fullUsers.map((u) => [u.id, u]));

  // Create payout records for each cleaner
  for (const cleaner of payableCleaners) {
    const user = userMap.get(cleaner.cleaner.id)!;
    const method = determinePayoutMethod(user);

    await db.payout.create({
      data: {
        payrollRunId: run.id,
        cleanerId: user.id,
        amount: cleaner.totals.grossPay,
        shoppingReimbursement: cleaner.totals.shoppingReimbursements,
        transportAllowance: cleaner.jobs.reduce((s, j) => s + (j.transportAllowance ?? 0), 0),
        adjustments: cleaner.totals.adjustments,
        status: PayoutStatus.PENDING,
        method,
        bankBsb: user.bankBsb,
        bankAccountNumber: user.bankAccountNumber,
        bankAccountName: user.bankAccountName,
        stripeAccountId: user.stripeAccountId,
      },
    });
  }

  return run;
}

/**
 * List all payroll runs with payouts.
 */
export async function listPayrollRuns(options?: { status?: PayrollRunStatus; limit?: number }) {
  const runs = await db.payrollRun.findMany({
    where: options?.status ? { status: options.status } : undefined,
    include: { payouts: { include: { cleaner: { select: { id: true, name: true, email: true } } } } },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 50,
  });

  return runs.map((run) => ({
    ...run,
    payouts: run.payouts.map((p) => ({
      id: p.id,
      cleanerId: p.cleanerId,
      cleanerName: p.cleaner.name,
      cleanerEmail: p.cleaner.email,
      amount: p.amount,
      status: p.status,
      method: p.method,
      failureReason: p.failureReason,
    })),
  }));
}

/**
 * Get a single payroll run with full detail.
 */
export async function getPayrollRun(runId: string): Promise<PayrollRunDetail | null> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { payouts: { include: { cleaner: true } } },
  });

  if (!run) return null;

  return {
    id: run.id,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    status: run.status,
    totalPayable: run.totalPayable,
    totalShoppingReimbursements: run.totalShoppingReimbursements,
    totalTransportAllowances: run.totalTransportAllowances,
    totalAdjustments: run.totalAdjustments,
    grandTotal: run.grandTotal,
    cleanerCount: run.cleanerCount,
    createdAt: run.createdAt,
    confirmedAt: run.confirmedAt,
    completedAt: run.completedAt,
    notes: run.notes,
    payouts: run.payouts.map((p) => ({
      id: p.id,
      cleanerId: p.cleanerId,
      cleanerName: p.cleaner.name,
      cleanerEmail: p.cleaner.email,
      amount: p.amount,
      shoppingReimbursement: p.shoppingReimbursement,
      transportAllowance: p.transportAllowance,
      adjustments: p.adjustments,
      status: p.status,
      method: p.method,
      bankBsb: p.bankBsb,
      bankAccountNumber: p.bankAccountNumber,
      bankAccountName: p.bankAccountName,
      stripeAccountId: p.stripeAccountId,
      failureReason: p.failureReason,
    })),
  };
}

/**
 * Confirm a payroll run — locks it and prevents further edits.
 */
export async function confirmPayrollRun(runId: string) {
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Payroll run not found");
  if (run.status !== PayrollRunStatus.DRAFT) throw new Error("Only DRAFT runs can be confirmed");

  return db.payrollRun.update({
    where: { id: runId },
    data: { status: PayrollRunStatus.CONFIRMED, confirmedAt: new Date() },
  });
}

/**
 * Process all payouts for a confirmed payroll run.
 * Uses Stripe Connect for cleaners with stripeAccountId, ABA file for others.
 */
export async function processPayrollRun(runId: string) {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { payouts: true },
  });
  if (!run) throw new Error("Payroll run not found");
  if (run.status !== PayrollRunStatus.CONFIRMED) throw new Error("Run must be confirmed before processing");

  await db.payrollRun.update({
    where: { id: runId },
    data: { status: PayrollRunStatus.PROCESSING },
  });

  let successCount = 0;
  let failCount = 0;

  for (const payout of run.payouts) {
    try {
      if (payout.method === PayoutMethod.STRIPE_CONNECT && payout.stripeAccountId) {
        await processStripePayout(payout);
      } else {
        // Mark as ready for ABA/manual processing
        await db.payout.update({
          where: { id: payout.id },
          data: { status: PayoutStatus.PENDING },
        });
      }
      successCount++;
    } catch (err) {
      await db.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.FAILED,
          failureReason: err instanceof Error ? err.message : "Unknown error",
        },
      });
      failCount++;
    }
  }

  const finalStatus = failCount > 0 ? PayrollRunStatus.FAILED : PayrollRunStatus.COMPLETED;
  await db.payrollRun.update({
    where: { id: runId },
    data: { status: finalStatus, completedAt: new Date() },
  });

  return { successCount, failCount, status: finalStatus };
}

/**
 * Process a single Stripe Connect payout.
 */
async function processStripePayout(payout: { id: string; amount: number; stripeAccountId: string | null }) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

  if (!payout.stripeAccountId) throw new Error("Cleaner has no Stripe account ID");

  const amountCents = Math.round(payout.amount * 100);

  const res = await fetch("https://api.stripe.com/v1/transfers", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      amount: String(amountCents),
      currency: "aud",
      destination: payout.stripeAccountId,
      description: "sNeek Property Services - Payroll payout",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stripe transfer failed: ${body}`);
  }

  const data = await res.json() as { id: string };

  await db.payout.update({
    where: { id: payout.id },
    data: {
      status: PayoutStatus.PAID,
      stripePayoutId: data.id,
      processedAt: new Date(),
    },
  });
}

function determinePayoutMethod(user: { stripeAccountId: string | null; bankBsb: string | null; bankAccountNumber: string | null }): PayoutMethod {
  if (user.stripeAccountId) return PayoutMethod.STRIPE_CONNECT;
  if (user.bankBsb && user.bankAccountNumber) return PayoutMethod.ABA_FILE;
  return PayoutMethod.MANUAL_BANK_TRANSFER;
}
