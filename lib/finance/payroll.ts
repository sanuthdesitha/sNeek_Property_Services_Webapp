import { PayAdjustmentStatus, QaAssignmentStatus, Role } from "@prisma/client";
import { sydneyDayStart, sydneyDayEndInclusive } from "@/lib/time/sydney-range";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { computeCleanerPay } from "@/lib/finance/job-money";
import { adjustmentSignedAmount } from "@/lib/finance/pay-adjustments";
import {
  computeQaAssignmentPay,
  qaAssignmentSettlementAmount,
} from "@/lib/finance/qa-pay";
import { qaAssignmentHasPayeeWhere, qaAssignmentPayeeId } from "@/lib/qa/ownership";

export async function getPayrollSummary(input: {
  startDate: string;
  endDate: string;
  // When true (used by payroll-run creation), exclude jobs already attached to a
  // payroll run so the same job is never paid twice across overlapping runs.
  excludePaidJobs?: boolean;
}) {
  const settings = await getAppSettings();
  // Bucket by Australia/Sydney calendar days (matches the invoices/reports the
  // pay is reconciled against). Inclusive end via lte below.
  const start = sydneyDayStart(input.startDate);
  const endInclusive = sydneyDayEndInclusive(input.endDate);

  const [cleaners, jobs, adjustments, shoppingRuns, qaAssignments] = await Promise.all([
    db.user.findMany({
      where: { role: Role.CLEANER, isActive: true },
      select: { id: true, name: true, email: true, hourlyRate: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    db.job.findMany({
      where: {
        // Bucket by completion date when set (a job finished next-day/custom date
        // counts in that period); fall back to the scheduled date otherwise.
        OR: [
          { completedAt: { gte: start, lte: endInclusive } },
          { completedAt: null, scheduledDate: { gte: start, lte: endInclusive } },
        ],
        status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
        // Skipped cleans are never paid out.
        cleanSkipStatus: { not: "SKIPPED" },
        ...(input.excludePaidJobs ? { payrollRunId: null } : {}),
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        scheduledDate: true,
        completedAt: true,
        estimatedHours: true,
        internalNotes: true,
        isRework: true,
        reworkPayAmount: true,
        property: { select: { name: true, suburb: true } },
        assignments: {
          where: { removedAt: null },
          select: { userId: true, payRate: true },
        },
        timeLogs: {
          where: { stoppedAt: { not: null } },
          select: { userId: true, durationM: true },
        },
      },
      orderBy: [{ scheduledDate: "asc" }],
    }),
    db.cleanerPayAdjustment.findMany({
      where: {
        // Committable run: everything approved up to the end of the period that
        // no run has paid yet. The lower bound is deliberately dropped here —
        // with it, an adjustment approved AFTER its period closed fell outside
        // every subsequent run's window too and was never paid at all. The
        // includedInPayrollRunId guard is what prevents double payment, not the
        // date window. The read-only period view keeps the bounded window so a
        // historical report of a period doesn't change under it.
        reviewedAt: input.excludePaidJobs
          ? { lte: endInclusive }
          : { gte: start, lte: endInclusive },
        status: PayAdjustmentStatus.APPROVED,
        // When building a committable run, never re-include an adjustment already
        // paid by a prior run (idempotency).
        ...(input.excludePaidJobs ? { includedInPayrollRunId: null } : {}),
      },
      select: {
        id: true,
        cleanerId: true,
        title: true,
        requestedAmount: true,
        approvedAmount: true,
        reviewedAt: true,
        jobId: true,
        property: { select: { name: true } },
      },
    }),
    // Shopping reimbursements: runs where cleaner paid out of pocket and is owed reimbursement
    db.shoppingRun.findMany({
      where: {
        updatedAt: { gte: start, lte: endInclusive },
        settlements: {
          some: {
            clientBillable: false,
            adminApprovedForCleanerReimbursement: true,
            includeInCleanerInvoice: false,
            // When creating a run, never re-include a reimbursement already
            // settled by EITHER rail. `includeInCleanerInvoice` above is a
            // routing flag, not a settlement record — it says the run is meant
            // for the invoice rail, not that an invoice actually billed it. Only
            // `includedInCleanerInvoiceId` proves that, so both are checked.
            ...(input.excludePaidJobs
              ? { includedInPayrollRunId: null, includedInCleanerInvoiceId: null }
              : {}),
          },
        },
      },
      include: {
        settlements: {
          where: {
            // A ShoppingRun has exactly ONE settlement (every write does
            // `settlements: { deleteMany, create: [one] }`), and clientBillable is
            // therefore a run-level flag. clientBillable:false is included here
            // defensively so that even a legacy multi-settlement row would only
            // match the non-billable, reimbursable settlement.
            clientBillable: false,
            adminApprovedForCleanerReimbursement: true,
            includeInCleanerInvoice: false,
            // Must mirror the `some` filter above exactly, or the run matches and
            // then arrives with an empty settlements array.
            ...(input.excludePaidJobs
              ? { includedInPayrollRunId: null, includedInCleanerInvoiceId: null }
              : {}),
          },
        },
        lines: true,
      },
    }),
    // COMPLETED QA inspections in the period. QA inspectors are paid for the
    // inspection itself (lib/finance/qa-pay.ts), not just for the adjustment
    // credits they occasionally earn — this is the same rail as cleaner job
    // pay, with the same "already settled" idempotency guard.
    db.qaAssignment.findMany({
      where: {
        status: QaAssignmentStatus.COMPLETED,
        completedAt: { gte: start, lte: endInclusive },
        // "Has a payee at all" — an inspection picked up by an inspector has a
        // null `assignedToId`, so requiring an assignee here silently excluded
        // every self-serve inspection from every pay run. Attribution to a
        // specific payee happens in memory below via qaAssignmentPayeeId.
        ...qaAssignmentHasPayeeWhere(),
        // A committable run must never re-pay an inspection already settled by a
        // prior run OR already billed on a cleaner invoice (the two settlement
        // rails). The read-only period view shows everything in the window.
        ...(input.excludePaidJobs
          ? { includedInPayrollRunId: null, includedInCleanerInvoiceId: null }
          : {}),
      },
      select: {
        id: true,
        assignedToId: true,
        // Required by qaAssignmentPayeeId — a self-picked-up inspection carries
        // its payee here and nowhere else.
        pickedUpById: true,
        status: true,
        completedAt: true,
        onSiteMinutes: true,
        payMode: true,
        payAmount: true,
        payHourlyRate: true,
        payHoursAllocated: true,
        payNote: true,
        paySettledAmount: true,
        includedInPayrollRunId: true,
        includedInCleanerInvoiceId: true,
        job: {
          select: {
            id: true,
            jobNumber: true,
            property: { select: { name: true, suburb: true } },
          },
        },
      },
      orderBy: [{ completedAt: "asc" }],
    }),
  ]);

  // Payees who are owed an approved adjustment but are NOT role CLEANER.
  //
  // QA rework credits and QA_RECTIFICATION_PAY are written as a positive
  // CleanerPayAdjustment against the QA INSPECTOR (lib/qa/rework-transfers.ts,
  // app/api/admin/qa/issues/[id]/route.ts). The cleaner query above filters on
  // `role: CLEANER`, so a QA_INSPECTOR payee never appeared as a payroll row at
  // all and their approved credit was silently dropped from every run — the
  // approval "took" in the database and paid nobody. Append them as
  // adjustment-only rows (no job lines: they hold no cleaner assignments).
  //
  // The same applies to QA INSPECTORS who completed paid inspections: they hold
  // no cleaner assignments, so without this they would never appear on a run at
  // all and their inspection pay would be computed and then dropped.
  const cleanerIdSet = new Set(cleaners.map((row) => row.id));
  const extraPayeeIds = Array.from(
    new Set(
      [
        ...adjustments.map((row) => row.cleanerId),
        ...qaAssignments.map((row) => qaAssignmentPayeeId(row)),
      ].filter((id): id is string => Boolean(id) && !cleanerIdSet.has(id as string))
    )
  );
  const extraPayees = extraPayeeIds.length
    ? await db.user.findMany({
        where: { id: { in: extraPayeeIds } },
        select: { id: true, name: true, email: true, hourlyRate: true },
        orderBy: [{ name: "asc" }, { email: "asc" }],
      })
    : [];
  const payees = [...cleaners, ...extraPayees];

  // Build shopping reimbursement map by cleaner
  const shoppingByCleaner = new Map<string, { id: string; settlementId: string; title: string; amount: number; updatedAt: Date }[]>();
  for (const run of shoppingRuns) {
    // One settlement per run (invariant enforced at every write), so settlements[0]
    // is THE settlement and summing all of the run's line costs is the correct
    // reimbursement — the whole run was paid by this one cleaner.
    const settlement = run.settlements[0];
    if (!settlement) continue;
    if (!settlement.paidByUserId) continue;
    const amount = Number(settlement.clientBillable ? 0 : (run.lines.reduce((sum, l) => sum + Number(l.lineCost ?? 0), 0)));
    if (amount <= 0) continue;
    const list = shoppingByCleaner.get(settlement.paidByUserId) || [];
    list.push({ id: run.id, settlementId: settlement.id, title: run.title || "Shopping reimbursement", amount, updatedAt: run.updatedAt });
    shoppingByCleaner.set(settlement.paidByUserId, list);
  }

  // Shopping time tracking not yet implemented — empty map
  const shoppingTimeByCleaner = new Map<string, { id: string; minutes: number; rate: number; amount: number }[]>();

  return payees.map((cleaner) => {
    const jobRows = jobs.flatMap((job) => {
      const activeAssignments = job.assignments;
      const assignment = activeAssignments.find((row) => row.userId === cleaner.id);
      if (!assignment) return [];
      const splitCount = Math.max(1, activeAssignments.length);
      const timerHours = job.timeLogs
        .filter((row) => row.userId === cleaner.id)
        .reduce((sum, row) => sum + Number(row.durationM ?? 0) / 60, 0);

      // Job meta carries per-cleaner overrides (transport allowance + custom payout).
      const notes = parseJobInternalNotes(job.internalNotes as string | null);

      // Rework pay is governed ENTIRELY by the QA decision (reworkPayAmount), never
      // hours×rate — an unpaid rework (reworkPayAmount null) pays $0, a paid one
      // pays exactly what QA set. This can't leak back to the hourly rate even if
      // the cleanerPayouts meta is missing on a legacy/admin-created rework.
      const reworkCustomPayout = job.isRework
        ? typeof job.reworkPayAmount === "number" && Number.isFinite(job.reworkPayAmount)
          ? job.reworkPayAmount
          : 0
        : undefined;
      const effectiveCustomPayout =
        reworkCustomPayout !== undefined ? reworkCustomPayout : notes.cleanerPayouts?.[cleaner.id];

      // Canonical cleaner-pay math (single source of truth). Approved adjustments
      // are listed separately as adjustment rows below, so they are NOT passed
      // here (would otherwise be double-counted in grossPay).
      const pay = computeCleanerPay(
        { jobType: job.jobType, estimatedHours: job.estimatedHours },
        { payRate: assignment.payRate, userHourlyRate: cleaner.hourlyRate },
        { cleanerJobHourlyRates: settings.cleanerJobHourlyRates },
        {
          cleanerId: cleaner.id,
          activeAssignmentCount: splitCount,
          timerHours,
          customPayout: effectiveCustomPayout,
          transportAllowance: notes.transportAllowances?.[cleaner.id],
          approvedAdjustments: 0,
        }
      );

      return [{
        id: job.id,
        jobNumber: job.jobNumber,
        propertyName: job.property.name,
        suburb: job.property.suburb,
        jobType: job.jobType,
        scheduledDate: job.completedAt ?? job.scheduledDate,
        hours: pay.hours,
        rate: pay.rate,
        rateMissing: pay.rateMissing,
        baseGross: pay.base,
        isCustomPayout: pay.source === "CUSTOM",
        transportAllowance: pay.transportAllowance,
        gross: pay.total,
      }];
    });

    const adjustmentRows = adjustments
      .filter((row) => row.cleanerId === cleaner.id)
      .map((row) => ({
        id: row.id,
        label: row.title || row.property?.name || "Approved adjustment",
        reviewedAt: row.reviewedAt,
        // Signed — deductions are stored negative and must stay negative.
        amount: adjustmentSignedAmount({
          status: PayAdjustmentStatus.APPROVED,
          approvedAmount: row.approvedAmount,
          requestedAmount: row.requestedAmount,
        }),
      }));

    // QA inspection lines for this payee. Pay is FROZEN once settled
    // (paySettledAmount) so a later rate or settings change can never retro-alter
    // what a historical run actually paid out.
    const qaRows = qaAssignments
      .filter((row) => qaAssignmentPayeeId(row) === cleaner.id)
      .map((row) => {
        const pay = computeQaAssignmentPay({
          assignment: row,
          inspector: { hourlyRate: cleaner.hourlyRate },
          settings: settings.qaPay,
        });
        return {
          id: row.id,
          jobId: row.job?.id ?? null,
          jobNumber: row.job?.jobNumber ?? null,
          propertyName: row.job?.property?.name ?? "Inspection",
          suburb: row.job?.property?.suburb ?? null,
          completedAt: row.completedAt,
          mode: pay.mode,
          basis: pay.basis,
          hours: pay.hours,
          rate: pay.rate,
          rateMissing: pay.rateMissing,
          note: row.payNote ?? null,
          amount: qaAssignmentSettlementAmount(row, pay.amount),
        };
      })
      // A $0 inspection (mode NONE, or nothing configured) is not a payable line.
      .filter((row) => row.amount > 0);

    const shoppingRows = (shoppingByCleaner.get(cleaner.id) || []).map((row) => ({
      id: row.id,
      settlementId: row.settlementId,
      label: row.title,
      updatedAt: row.updatedAt,
      amount: row.amount,
    }));

    const shoppingTimeRows = (shoppingTimeByCleaner.get(cleaner.id) || []).map((row) => ({
      id: row.id,
      label: `Shopping time (${row.minutes}min @ $${row.rate.toFixed(2)}/hr)`,
      amount: Number(row.amount.toFixed(2)),
    }));

    const jobGross = jobRows.reduce((sum, row) => sum + row.gross, 0);
    const adjustmentsTotal = adjustmentRows.reduce((sum, row) => sum + row.amount, 0);
    const shoppingTotal = shoppingRows.reduce((sum, row) => sum + row.amount, 0);
    const shoppingTimeTotal = shoppingTimeRows.reduce((sum, row) => sum + row.amount, 0);
    const qaTotal = qaRows.reduce((sum, row) => sum + row.amount, 0);
    return {
      cleaner,
      jobs: jobRows,
      adjustments: adjustmentRows,
      qaInspections: qaRows,
      shoppingReimbursements: shoppingRows,
      shoppingTime: shoppingTimeRows,
      totals: {
        paidHours: Number(jobRows.reduce((sum, row) => sum + row.hours, 0).toFixed(2)),
        jobGross: Number(jobGross.toFixed(2)),
        adjustments: Number(adjustmentsTotal.toFixed(2)),
        qaInspections: Number(qaTotal.toFixed(2)),
        shoppingReimbursements: Number(shoppingTotal.toFixed(2)),
        shoppingTime: Number(shoppingTimeTotal.toFixed(2)),
        grossPay: Number(
          (jobGross + adjustmentsTotal + qaTotal + shoppingTotal + shoppingTimeTotal).toFixed(2)
        ),
      },
    };
  });
}

export function buildPayslipHtml(input: {
  companyName: string;
  logoUrl?: string | null;
  cleaner: { name: string | null; email: string; hourlyRate: number | null };
  rows: Array<{ jobNumber: string | null; propertyName: string; jobType: string; scheduledDate: Date; hours: number; rate: number; gross: number }>;
  adjustments: Array<{ label: string; amount: number; reviewedAt: Date | null }>;
  totals: { paidHours: number; jobGross: number; adjustments: number; grossPay: number };
  startDate: string;
  endDate: string;
}) {
  const cleanerName = input.cleaner.name?.trim() || input.cleaner.email;
  const jobRows = input.rows.map((row) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.jobNumber || row.propertyName}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.propertyName}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.jobType.replace(/_/g, " ")}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.scheduledDate.toISOString().slice(0, 10)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${row.hours.toFixed(2)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$${row.rate.toFixed(2)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$${row.gross.toFixed(2)}</td>
    </tr>
  `).join("");
  const adjustmentRows = input.adjustments.map((row) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.label}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.reviewedAt ? row.reviewedAt.toISOString().slice(0, 10) : "—"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$${row.amount.toFixed(2)}</td>
    </tr>
  `).join("");

  return `
    <html>
      <body style="font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:32px;">
        <div style="max-width:960px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ee;border-radius:24px;padding:32px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
            <div>
              <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#0f766e;font-weight:700;">Payslip</div>
              <h1 style="margin:10px 0 0;font-size:32px;">${input.companyName}</h1>
              <p style="margin:12px 0 0;">${cleanerName}<br/>${input.cleaner.email}</p>
              <p style="margin:12px 0 0;color:#64748b;">Period ${input.startDate} to ${input.endDate}</p>
            </div>
            ${input.logoUrl ? `<img src="${input.logoUrl}" alt="${input.companyName}" style="max-height:72px;max-width:180px;object-fit:contain;" />` : ""}
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:24px;">
            <div style="border:1px solid #e5e7eb;border-radius:18px;padding:14px;"><div style="font-size:12px;color:#64748b;">Paid hours</div><div style="font-size:24px;font-weight:700;">${input.totals.paidHours.toFixed(2)}</div></div>
            <div style="border:1px solid #e5e7eb;border-radius:18px;padding:14px;"><div style="font-size:12px;color:#64748b;">Job gross</div><div style="font-size:24px;font-weight:700;">$${input.totals.jobGross.toFixed(2)}</div></div>
            <div style="border:1px solid #e5e7eb;border-radius:18px;padding:14px;"><div style="font-size:12px;color:#64748b;">Adjustments</div><div style="font-size:24px;font-weight:700;">$${input.totals.adjustments.toFixed(2)}</div></div>
            <div style="border:1px solid #e5e7eb;border-radius:18px;padding:14px;"><div style="font-size:12px;color:#64748b;">Gross pay</div><div style="font-size:24px;font-weight:700;">$${input.totals.grossPay.toFixed(2)}</div></div>
          </div>
          <h2 style="margin-top:32px;font-size:20px;">Job lines</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:10px;">Job</th><th style="text-align:left;padding:10px;">Property</th><th style="text-align:left;padding:10px;">Type</th><th style="text-align:left;padding:10px;">Date</th><th style="text-align:right;padding:10px;">Hours</th><th style="text-align:right;padding:10px;">Rate</th><th style="text-align:right;padding:10px;">Gross</th></tr></thead>
            <tbody>${jobRows || `<tr><td colspan="7" style="padding:16px;text-align:center;color:#64748b;">No completed jobs in this range.</td></tr>`}</tbody>
          </table>
          <h2 style="margin-top:32px;font-size:20px;">Approved adjustments</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:10px;">Adjustment</th><th style="text-align:left;padding:10px;">Date</th><th style="text-align:right;padding:10px;">Amount</th></tr></thead>
            <tbody>${adjustmentRows || `<tr><td colspan="3" style="padding:16px;text-align:center;color:#64748b;">No approved adjustments in this range.</td></tr>`}</tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}
