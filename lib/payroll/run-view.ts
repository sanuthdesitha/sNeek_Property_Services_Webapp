import "server-only";
/**
 * Data for the pay run page (board "Pay run", 2026-11-17): the stored run and
 * payouts (getPayrollRun), each payout's problem flags and job count, who
 * created the run and made its ABA file, whether this server has a Stripe key
 * (provider configuration, never a success), and the run's own history from
 * its stored dates and audit rows. Display only: no amount is computed here.
 *
 * Each part fails on its own and says so; a run that cannot be read is an
 * error, never a page of $0.00 tiles.
 */
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getPayrollRun, type PayoutDetail } from "./engine";
import { payoutProblems, type PayoutProblem } from "./run-presentation";

export type PayrollPayoutView = Omit<PayoutDetail, "status" | "method"> & {
  status: string;
  method: string;
  /** Jobs stamped with this run on which this person holds the assignment. */
  jobCount: number;
  problems: PayoutProblem[];
};

export type PayrollHistoryEntry = { id: string; at: string; label: string; actor: string | null };

export type PayrollRunView = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalPayable: number;
  totalShoppingReimbursements: number;
  totalTransportAllowances: number;
  totalAdjustments: number;
  grandTotal: number;
  cleanerCount: number;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  createdByName: string | null;
  abaGeneratedAt: string | null;
  abaGeneratedByName: string | null;
  stripeConfigured: boolean;
  timezone: string;
  payouts: PayrollPayoutView[];
  history: PayrollHistoryEntry[] | { error: string };
};

export type PayrollRunLoad = { ok: true; view: PayrollRunView } | { ok: false; reason: "not-found" } | { ok: false; reason: "error"; message: string };

const STATUS_WORDS: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  VOID: "Void",
  PENDING: "Pending",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function word(value: unknown): string {
  return typeof value === "string" ? STATUS_WORDS[value] ?? value : "an unknown status";
}

/** One history line per audit row this page writes or reads. */
export function describePayrollAudit(action: string, after: unknown, payeeName: (payoutId: string) => string | null): string {
  if (action === "PAYROLL_RUN_PROCESSED") {
    const success = field(after, "successCount");
    const failed = field(after, "failCount");
    return `Payouts sent: ${typeof success === "number" ? success : "?"} done, ${typeof failed === "number" ? failed : "?"} failed; run ${word(field(after, "status"))}`;
  }
  if (action === "PAYROLL_STATUS_MANUAL_UPDATE") {
    const payoutId = field(after, "payoutId");
    if (typeof payoutId === "string") {
      const who = payeeName(payoutId) ?? "a payout";
      return `${who} set to ${word(field(after, "payoutStatus"))}`;
    }
    const reason = field(after, "reason");
    return `Run status changed to ${word(field(after, "status"))}${typeof reason === "string" && reason ? `: ${reason}` : ""}`;
  }
  return action;
}

async function readHistory(runId: string, payeeName: (payoutId: string) => string | null): Promise<PayrollHistoryEntry[] | { error: string }> {
  try {
    const rows = await db.auditLog.findMany({
      where: { entity: "PayrollRun", entityId: runId },
      select: { id: true, action: true, after: true, createdAt: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      label: describePayrollAudit(row.action, row.after, payeeName),
      actor: row.user?.name || row.user?.email || null,
    }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "History could not be read." };
  }
}

async function jobCounts(runId: string, cleanerIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!cleanerIds.length) return counts;
  const assignments = await db.jobAssignment.findMany({
    where: { userId: { in: cleanerIds }, job: { payrollRunId: runId } },
    select: { userId: true },
  });
  for (const row of assignments) counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
  return counts;
}

async function userName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const user = await db.user.findUnique({ where: { id }, select: { name: true, email: true } });
  return user?.name || user?.email || null;
}

export async function loadPayrollRunView(runId: string): Promise<PayrollRunLoad> {
  try {
    const run = await getPayrollRun(runId);
    if (!run) return { ok: false, reason: "not-found" };
    const meta = await db.payrollRun.findUnique({
      where: { id: runId },
      select: { createdByUserId: true, abaGeneratedAt: true, abaGeneratedById: true },
    });
    const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
    const [counts, createdByName, abaGeneratedByName, settings] = await Promise.all([
      jobCounts(runId, run.payouts.map((payout) => payout.cleanerId)),
      userName(meta?.createdByUserId ?? null),
      userName(meta?.abaGeneratedById ?? null),
      getAppSettings(),
    ]);
    const payouts: PayrollPayoutView[] = run.payouts.map((payout) => ({
      ...payout,
      status: String(payout.status),
      method: String(payout.method),
      jobCount: counts.get(payout.cleanerId) ?? 0,
      problems: payoutProblems(payout, { stripeConfigured }),
    }));
    const names = new Map(payouts.map((payout) => [payout.id, payout.cleanerName || payout.cleanerEmail]));
    const history = await readHistory(runId, (payoutId) => names.get(payoutId) ?? null);
    return {
      ok: true,
      view: {
        id: run.id,
        periodStart: run.periodStart.toISOString(),
        periodEnd: run.periodEnd.toISOString(),
        status: String(run.status),
        totalPayable: run.totalPayable,
        totalShoppingReimbursements: run.totalShoppingReimbursements,
        totalTransportAllowances: run.totalTransportAllowances,
        totalAdjustments: run.totalAdjustments,
        grandTotal: run.grandTotal,
        cleanerCount: run.cleanerCount,
        createdAt: run.createdAt.toISOString(),
        confirmedAt: run.confirmedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        notes: run.notes,
        createdByName,
        abaGeneratedAt: meta?.abaGeneratedAt?.toISOString() ?? null,
        abaGeneratedByName,
        stripeConfigured,
        timezone: settings.timezone || "Australia/Sydney",
        payouts,
        history,
      },
    };
  } catch (error) {
    return { ok: false, reason: "error", message: error instanceof Error ? error.message : "This pay run could not be loaded." };
  }
}
