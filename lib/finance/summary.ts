import { JobStatus, PayAdjustmentStatus, QuoteStatus, StockTxType } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getInventoryUnitCosts } from "@/lib/inventory/unit-costs";

export interface FinanceSummaryRow {
  clientId: string;
  clientName: string;
  revenue: number;
  cleanerCost: number;
  laundryCost: number;
  suppliesCost: number;
  totalCost: number;
  grossMargin: number;
  marginPct: number | null;
}

export interface FinanceSummary {
  start: string;
  end: string;
  totals: {
    revenue: number;
    cleanerCost: number;
    laundryCost: number;
    suppliesCost: number;
    totalCost: number;
    grossMargin: number;
    marginPct: number | null;
  };
  byClient: FinanceSummaryRow[];
  counts: {
    quotesCount: number;
    jobsCount: number;
    laundryJobsCount: number;
    stockTransactionsCount: number;
  };
}

function parseMaybeJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseRange(input: { startDate?: string; endDate?: string }) {
  const now = new Date();
  const start = input.startDate
    ? new Date(`${input.startDate}T00:00:00.000Z`)
    : new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = input.endDate
    ? new Date(`${input.endDate}T23:59:59.999Z`)
    : now;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date range.");
  }
  return { start, end };
}

type MutableRow = Omit<FinanceSummaryRow, "totalCost" | "grossMargin" | "marginPct">;

function ensureClientRow(
  map: Map<string, MutableRow>,
  clientId: string | null | undefined,
  clientName: string | null | undefined
) {
  const key = clientId || "unassigned";
  if (!map.has(key)) {
    map.set(key, {
      clientId: key,
      clientName: clientName?.trim() || "Unassigned",
      revenue: 0,
      cleanerCost: 0,
      laundryCost: 0,
      suppliesCost: 0,
    });
  }
  return map.get(key)!;
}

export async function getFinanceSummary(input: { startDate?: string; endDate?: string }): Promise<FinanceSummary> {
  const { start, end } = parseRange(input);
  const [settings, unitCosts, quotes, jobs, laundryTasks, stockTxs] = await Promise.all([
    getAppSettings(),
    getInventoryUnitCosts(),
    db.quote.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: { in: [QuoteStatus.ACCEPTED, QuoteStatus.CONVERTED] },
      },
      include: {
        client: { select: { id: true, name: true } },
      },
    }),
    db.job.findMany({
      where: {
        scheduledDate: { gte: start, lte: end },
        status: {
          in: [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED],
        },
      },
      include: {
        property: { select: { clientId: true, client: { select: { name: true } } } },
        assignments: { select: { userId: true, payRate: true, removedAt: true } },
        timeLogs: { select: { userId: true, durationM: true, stoppedAt: true } },
        payAdjustments: {
          where: { status: PayAdjustmentStatus.APPROVED },
          select: { approvedAmount: true, requestedAmount: true },
        },
      },
    }),
    db.laundryTask.findMany({
      where: { droppedAt: { gte: start, lte: end } },
      include: {
        property: { select: { clientId: true, client: { select: { name: true } } } },
        confirmations: { orderBy: { createdAt: "asc" } },
      },
    }),
    db.stockTx.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        txType: StockTxType.USED,
      },
      include: {
        propertyStock: {
          select: {
            itemId: true,
            property: { select: { clientId: true, client: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);

  const byClient = new Map<string, MutableRow>();

  let revenue = 0;
  for (const quote of quotes) {
    const row = ensureClientRow(byClient, quote.clientId, quote.client?.name);
    const amount = Number(quote.totalAmount || 0);
    revenue += amount;
    row.revenue += amount;
  }

  let cleanerCost = 0;
  for (const job of jobs) {
    const row = ensureClientRow(byClient, job.property.clientId, job.property.client?.name ?? null);
    const assignments = job.assignments.filter((assignment) => !assignment.removedAt);
    const splitCount = Math.max(1, assignments.length);
    const allocatedHours = Number(job.estimatedHours ?? 0);
    const hasAllocatedHours = Number.isFinite(allocatedHours) && allocatedHours > 0;
    const paidHoursPerCleaner = hasAllocatedHours ? allocatedHours / splitCount : 0;

    let jobCleanerCost = 0;
    for (const assignment of assignments) {
      const configuredRate =
        settings.cleanerJobHourlyRates?.[assignment.userId]?.[job.jobType] ?? null;
      const rate = Number(assignment.payRate ?? configuredRate ?? 40);
      if (!(rate > 0)) continue;
      const timerHoursForCleaner = job.timeLogs
        .filter((log) => log.userId === assignment.userId && log.stoppedAt)
        .reduce((sum, log) => sum + Number(log.durationM ?? 0) / 60, 0);
      const paidHours = hasAllocatedHours ? paidHoursPerCleaner : Math.max(0, timerHoursForCleaner);
      if (paidHours > 0) {
        jobCleanerCost += paidHours * rate;
      }
    }

    for (const adjustment of job.payAdjustments) {
      jobCleanerCost += Number(adjustment.approvedAmount ?? adjustment.requestedAmount ?? 0);
    }

    cleanerCost += jobCleanerCost;
    row.cleanerCost += jobCleanerCost;
  }

  let laundryCost = 0;
  for (const task of laundryTasks) {
    const row = ensureClientRow(
      byClient,
      task.property.clientId,
      task.property.client?.name ?? null
    );
    const dropped = [...task.confirmations]
      .reverse()
      .find((confirmation) => parseMaybeJson(confirmation.notes)?.event === "DROPPED");
    const droppedMeta = parseMaybeJson(dropped?.notes);
    const taskAmount =
      typeof droppedMeta?.totalPrice === "number" && Number.isFinite(droppedMeta.totalPrice)
        ? Number(droppedMeta.totalPrice)
        : 0;
    laundryCost += taskAmount;
    row.laundryCost += taskAmount;
  }

  let suppliesCost = 0;
  for (const tx of stockTxs) {
    const row = ensureClientRow(
      byClient,
      tx.propertyStock.property.clientId,
      tx.propertyStock.property.client?.name ?? null
    );
    const unitCost = Number(unitCosts[tx.propertyStock.itemId] ?? 0);
    if (!(unitCost > 0)) continue;
    const quantity = Math.abs(Number(tx.quantity ?? 0));
    if (!(quantity > 0)) continue;
    const lineCost = unitCost * quantity;
    suppliesCost += lineCost;
    row.suppliesCost += lineCost;
  }

  const byClientRows: FinanceSummaryRow[] = Array.from(byClient.values())
    .map((row) => {
      const totalCost = row.cleanerCost + row.laundryCost + row.suppliesCost;
      const grossMargin = row.revenue - totalCost;
      return {
        ...row,
        totalCost,
        grossMargin,
        marginPct: row.revenue > 0 ? (grossMargin / row.revenue) * 100 : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const totalCost = cleanerCost + laundryCost + suppliesCost;
  const grossMargin = revenue - totalCost;
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    totals: {
      revenue,
      cleanerCost,
      laundryCost,
      suppliesCost,
      totalCost,
      grossMargin,
      marginPct: revenue > 0 ? (grossMargin / revenue) * 100 : null,
    },
    byClient: byClientRows,
    counts: {
      quotesCount: quotes.length,
      jobsCount: jobs.length,
      laundryJobsCount: laundryTasks.length,
      stockTransactionsCount: stockTxs.length,
    },
  };
}
