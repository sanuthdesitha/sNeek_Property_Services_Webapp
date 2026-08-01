/**
 * CANONICAL per-job pay summary — the ONE derivation of "what does this job pay
 * each payee, and which adjustments changed that number" (pay-transparency wave,
 * 2026-07). Every surface that shows a job's cleaner pay or its adjustments —
 * admin job details, the cleaner's own job view, cleaner invoices, the Approval
 * Center cards, the QA pay page — must read from here (or from the same
 * underlying helpers) rather than re-deriving amounts inline.
 *
 * PURE module — no DB, no I/O, safe to import from client components (the
 * shared pay-adjustment list imports it). The DB loader lives next door in
 * lib/finance/job-pay-summary-load.ts (`loadJobPaySummary`). The core
 * takes already-loaded rows and delegates ALL money math to the existing
 * canonical modules:
 *   - lib/finance/job-money.ts   computeCleanerPay  (base pay, rework rule)
 *   - lib/finance/pay-adjustments.ts                (signed amounts, APPROVED-only)
 *
 * CONSISTENCY RULE (requirement #2 made executable): a payee's `approvedTotal`
 * for a job equals what lib/cleaner/invoice.ts produces for that job's line +
 * its folded adjustments — both paths call computeCleanerPay with the same
 * inputs and sum adjustments with adjustmentSignedAmount. The unit test in
 * tests/lib/job-pay-summary-invoice-consistency.test.ts feeds identical
 * fixtures through both and asserts equality.
 *
 * PAYEE vs JOB LINKAGE (subtle): `CleanerPayAdjustment.cleanerId` is the PAYEE,
 * which is not necessarily a cleaner assigned to the job — a QA rectification
 * credit is written against the CLEANER'S job with cleanerId = the QA inspector.
 * The summary therefore groups strictly by PAYEE: such a row appears under the
 * QA user's entry (assigned: false, base $0), never inside the cleaner's total.
 */

import type { JobType } from "@prisma/client";
import { computeCleanerPay, roundCents } from "@/lib/finance/job-money";
import {
  adjustmentSignedAmount,
  sumAdjustments,
  type PayAdjustmentMoneyRow,
} from "@/lib/finance/pay-adjustments";

/* ── Origin derivation ─────────────────────────────────────────────────── */

export type PayAdjustmentOrigin = "AUTOMATIC" | "MANUAL";

/**
 * Every `source` value the system's automatic writers stamp today, with the
 * human label each shows on screen. Anything NOT in this table (null, legacy,
 * or an unknown future value) is treated as MANUAL — the safe reading, since
 * "automatic" is a provenance claim we must never fabricate.
 *
 * Writers (grep-verified):
 *   REWORK_DEDUCTION            lib/qa/rework-jobs.ts        sourceKey rework:<jobId>
 *   REWORK_TRANSFER_DEDUCTION   lib/qa/rework-transfers.ts   sourceKey rework-transfer:<id>
 *   REWORK_TRANSFER_CREDIT      lib/qa/rework-transfers.ts   sourceKey rework-transfer:<id>
 *   QA_RECTIFICATION_PAY        api/admin/qa/issues/[id]     sourceKey rect:<issueId>
 *   RECTIFICATION_DEDUCTION     api/admin/qa/issues/[id]     sourceKey rect:<issueId>:ded
 *   STREAK_5 / STREAK_10        lib/accountability/streaks   sourceKey streak5:/streak10:
 *   MONTHLY_RANK_1 / _2         lib/accountability/streaks   sourceKey monthly:<month>:<n>
 */
export const AUTOMATIC_ADJUSTMENT_SOURCE_LABELS: Record<string, string> = {
  REWORK_DEDUCTION: "rework deduction",
  REWORK_TRANSFER_DEDUCTION: "rework transfer deduction",
  REWORK_TRANSFER_CREDIT: "rework transfer credit",
  QA_RECTIFICATION_PAY: "QA rectification pay",
  RECTIFICATION_DEDUCTION: "rectification deduction",
  STREAK_5: "5-clean streak bonus",
  STREAK_10: "10-clean streak bonus",
  MONTHLY_RANK_1: "monthly ranking bonus (1st)",
  MONTHLY_RANK_2: "monthly ranking bonus (2nd)",
};

/** sourceKey prefixes the automatic writers use — the fallback signal when a
 *  row carries a key but a source value this build doesn't know. */
const AUTOMATIC_SOURCE_KEY_PREFIXES = [
  "rework:",
  "rework-transfer:",
  "rect:",
  "streak5:",
  "streak10:",
  "monthly:",
];

export interface AdjustmentOriginInfo {
  origin: PayAdjustmentOrigin;
  /** Full display label, e.g. "Automatic — rework deduction" / "Manual". */
  label: string;
}

/** Derive AUTOMATIC vs MANUAL from the (source, sourceKey) conventions. */
export function deriveAdjustmentOrigin(
  source: string | null | undefined,
  sourceKey?: string | null
): AdjustmentOriginInfo {
  const src = typeof source === "string" ? source.trim() : "";
  if (src && AUTOMATIC_ADJUSTMENT_SOURCE_LABELS[src]) {
    return { origin: "AUTOMATIC", label: `Automatic — ${AUTOMATIC_ADJUSTMENT_SOURCE_LABELS[src]}` };
  }
  const key = typeof sourceKey === "string" ? sourceKey.trim() : "";
  if (key && AUTOMATIC_SOURCE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return {
      origin: "AUTOMATIC",
      label: src ? `Automatic — ${src.replace(/_/g, " ").toLowerCase()}` : "Automatic",
    };
  }
  // A correcting adjustment raised by an admin against a settled row is manual
  // by definition, but say so explicitly when the provenance marker is present.
  if (src === "ADMIN_CORRECTION" || key.startsWith("correction:")) {
    return { origin: "MANUAL", label: "Manual — correcting adjustment" };
  }
  return { origin: "MANUAL", label: "Manual" };
}

/* ── Settlement + editability ──────────────────────────────────────────── */

export interface AdjustmentSettlement {
  rail: "PAYROLL" | "INVOICE";
  /** The payroll-run / cleaner-invoice id that settled the row. */
  id: string;
  /** When it was settled, when known (ISO). */
  at: string | null;
}

export interface AdjustmentSettlementRow {
  includedInPayrollRunId?: string | null;
  includedInCleanerInvoiceId?: string | null;
  includedInCleanerInvoiceAt?: Date | string | null;
}

/** Which rail (if any) has already paid this row. Payroll checked first —
 *  the same precedence the PATCH route's 409 uses. */
export function adjustmentSettlement(row: AdjustmentSettlementRow): AdjustmentSettlement | null {
  if (row.includedInPayrollRunId) {
    return { rail: "PAYROLL", id: row.includedInPayrollRunId, at: null };
  }
  if (row.includedInCleanerInvoiceId) {
    const at = row.includedInCleanerInvoiceAt
      ? new Date(row.includedInCleanerInvoiceAt).toISOString()
      : null;
    return { rail: "INVOICE", id: row.includedInCleanerInvoiceId, at };
  }
  return null;
}

/** Roles allowed to hit the pay-adjustment PATCH route. */
const ADJUSTMENT_EDITOR_ROLES = new Set(["ADMIN", "OPS_MANAGER"]);

/**
 * THE editability rule (mirrors the server): an adjustment may be edited in
 * place iff the viewer is an admin/ops role AND the money has not been settled
 * by either rail. Status does NOT block editing — the PATCH route supports
 * approve, reject, re-price and reverse-to-pending on any unsettled row.
 * A settled row is immutable; the correct move is a correcting adjustment.
 */
export function isAdjustmentEditable(
  row: AdjustmentSettlementRow,
  viewerRole: string | null | undefined
): boolean {
  if (!viewerRole || !ADJUSTMENT_EDITOR_ROLES.has(viewerRole)) return false;
  return adjustmentSettlement(row) === null;
}

/* ── Display amount ────────────────────────────────────────────────────── */

export interface AdjustmentAmountRow {
  status: string;
  approvedAmount?: number | null;
  requestedAmount?: number | null;
}

/**
 * The signed amount a row DISPLAYS as. For APPROVED rows this is exactly what
 * `adjustmentSignedAmount` pays; for PENDING/REJECTED rows it is the signed
 * requested amount (what WOULD be paid), which counts toward `pendingDelta`
 * but never toward `approvedTotal`.
 */
export function adjustmentDisplayAmount(row: AdjustmentAmountRow): number {
  if (row.status === "APPROVED") {
    return adjustmentSignedAmount(row as PayAdjustmentMoneyRow);
  }
  const raw = Number(row.requestedAmount ?? 0);
  return Number.isFinite(raw) ? roundCents(raw) : 0;
}

/* ── The summary ───────────────────────────────────────────────────────── */

export interface JobPaySummaryAdjustment {
  id: string;
  /** Signed display amount (negative = deduction). */
  amount: number;
  /** Raw source value, or "MANUAL" when none. */
  kind: string;
  title: string;
  /** What/why free text (cleaner note + admin note, joined). */
  reason: string | null;
  origin: PayAdjustmentOrigin;
  originLabel: string;
  status: string;
  createdAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  settled: AdjustmentSettlement | null;
  /** True iff an admin may edit it in place (= not settled). */
  editable: boolean;
}

export interface JobPaySummaryBasePay {
  amount: number;
  /** How the hours were derived. NONE = payee not assigned (adjustment-only). */
  basis: "ALLOCATED" | "TIMER" | "NONE";
  hours: number;
  rate: number | null;
  rateMissing: boolean;
  split: number;
  /** CUSTOM (flat payout / rework decision) or JOBTYPE_RATE, NONE when unassigned. */
  source: "CUSTOM" | "JOBTYPE_RATE" | "NONE";
}

export interface CleanerJobPaySummary {
  cleanerId: string;
  cleanerName: string;
  cleanerRole: string | null;
  /** False for a payee who only holds adjustments on this job (QA credits). */
  assigned: boolean;
  basePay: JobPaySummaryBasePay;
  transportAllowance: number;
  adjustments: JobPaySummaryAdjustment[];
  /** base + transport + APPROVED adjustments — what invoice/payroll pays. */
  approvedTotal: number;
  /** Signed sum of PENDING adjustments — shown separately, never mixed in. */
  pendingDelta: number;
}

export interface JobPaySummaryAdjustmentInput
  extends AdjustmentAmountRow,
    AdjustmentSettlementRow {
  id: string;
  cleanerId: string;
  cleanerName?: string | null;
  cleanerRole?: string | null;
  title?: string | null;
  cleanerNote?: string | null;
  /** PRIVATE — internal audience only. */
  adminNote?: string | null;
  /** The explanation written FOR the payee; safe for either audience. */
  decisionMessage?: string | null;
  source?: string | null;
  sourceKey?: string | null;
  requestedAt?: Date | string | null;
  reviewedAt?: Date | string | null;
  reviewedByName?: string | null;
}

export interface JobPaySummaryInput {
  job: {
    jobType: JobType;
    estimatedHours: number | null;
    isRework?: boolean | null;
    reworkPayAmount?: number | null;
  };
  /** ALL assignments on the job (removed ones are filtered here, exactly as
   *  the invoice does). user carries the name + default rate. */
  assignments: Array<{
    userId: string;
    payRate: number | null;
    removedAt?: Date | string | null;
    userName?: string | null;
    userRole?: string | null;
    userHourlyRate?: number | null;
  }>;
  settings: { cleanerJobHourlyRates?: Record<string, Partial<Record<JobType, number>>> };
  /** jobMeta.cleanerPayouts / transportAllowances (parsed internalNotes). */
  cleanerPayouts?: Record<string, number>;
  transportAllowances?: Record<string, number>;
  /** EVERY CleanerPayAdjustment linked to this job, any status/payee. */
  adjustments: JobPaySummaryAdjustmentInput[];
  /** Clocked timer hours per cleaner — used only when no allocated hours. */
  timerHoursByCleaner?: Record<string, number>;
  /**
   * Who the summary is being built for. Required — see `PayAdjustmentAudience`.
   * Every current caller is an admin surface, but the type forces the next one
   * to say so rather than inherit an internal-only default.
   */
  audience: PayAdjustmentAudience;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Serialize one adjustment row into the shared display shape. */
/**
 * Who is going to read this row.
 *
 * `internal` — admin / ops / finance surfaces: the full reason, including the
 *   reviewing admin's note.
 * `self` — the payee looking at their own money. `adminNote` is the admin's
 *   PRIVATE note about the decision, written expecting an internal audience,
 *   and must never travel to the person it is about.
 *
 * Deliberately a REQUIRED parameter with no default. This function fed the
 * cleaner's own job screen with `Admin: {adminNote}` appended to every
 * adjustment reason, and a default is exactly how that happened — the cleaner
 * call site never had to think about the audience. Now it does.
 */
export type PayAdjustmentAudience = "internal" | "self";

export function describeAdjustment(
  row: JobPaySummaryAdjustmentInput,
  audience: PayAdjustmentAudience
): JobPaySummaryAdjustment {
  const originInfo = deriveAdjustmentOrigin(row.source ?? null, row.sourceKey ?? null);
  const settled = adjustmentSettlement(row);
  const reasonParts = [
    row.cleanerNote?.trim(),
    // The cleaner-facing explanation shows to BOTH audiences — it was written
    // to be read by the payee, and an admin reviewing the row should see what
    // the payee was told.
    row.decisionMessage?.trim() || null,
    audience === "internal" && row.adminNote?.trim() ? `Admin: ${row.adminNote!.trim()}` : null,
  ].filter((part): part is string => Boolean(part));
  return {
    id: row.id,
    amount: adjustmentDisplayAmount(row),
    kind: row.source?.trim() || "MANUAL",
    title: row.title?.trim() || row.cleanerNote?.trim() || "Pay adjustment",
    reason: reasonParts.length > 0 ? reasonParts.join(" · ") : null,
    origin: originInfo.origin,
    originLabel: originInfo.label,
    status: row.status,
    createdAt: toIso(row.requestedAt),
    decidedAt: toIso(row.reviewedAt),
    decidedBy: row.reviewedByName?.trim() || null,
    settled,
    editable: settled === null,
  };
}

/**
 * Compute the per-payee pay summary for one job. Grouping is strictly by PAYEE
 * (adjustment.cleanerId ∪ active assignment userIds) — see the module header.
 */
export function computeJobPaySummary(input: JobPaySummaryInput): CleanerJobPaySummary[] {
  const activeAssignments = input.assignments.filter((a) => !a.removedAt);
  const splitCount = Math.max(1, activeAssignments.length);

  // Payees in a stable order: assigned cleaners first, then adjustment-only.
  const payeeIds: string[] = [];
  const seen = new Set<string>();
  for (const a of activeAssignments) {
    if (a.userId && !seen.has(a.userId)) {
      seen.add(a.userId);
      payeeIds.push(a.userId);
    }
  }
  for (const adj of input.adjustments) {
    if (adj.cleanerId && !seen.has(adj.cleanerId)) {
      seen.add(adj.cleanerId);
      payeeIds.push(adj.cleanerId);
    }
  }

  return payeeIds.map((payeeId) => {
    const assignment = activeAssignments.find((a) => a.userId === payeeId) ?? null;
    const myAdjustments = input.adjustments.filter((adj) => adj.cleanerId === payeeId);
    const approvedRows = myAdjustments.filter((adj) => adj.status === "APPROVED");
    const approvedSum = sumAdjustments(approvedRows as PayAdjustmentMoneyRow[]);
    const pendingDelta = roundCents(
      myAdjustments
        .filter((adj) => adj.status === "PENDING")
        .reduce((sum, adj) => sum + adjustmentDisplayAmount(adj), 0)
    );
    const described = myAdjustments.map((adj) => describeAdjustment(adj, input.audience));
    const name =
      assignment?.userName?.trim() ||
      myAdjustments.find((adj) => adj.cleanerName?.trim())?.cleanerName?.trim() ||
      "Payee";
    const role =
      assignment?.userRole ??
      myAdjustments.find((adj) => adj.cleanerRole != null)?.cleanerRole ??
      null;

    if (!assignment) {
      // Adjustment-only payee (e.g. the QA credited on a cleaner's job): no
      // base pay, no transport — their money on this job is the adjustments.
      return {
        cleanerId: payeeId,
        cleanerName: name,
        cleanerRole: role,
        assigned: false,
        basePay: {
          amount: 0,
          basis: "NONE",
          hours: 0,
          rate: null,
          rateMissing: false,
          split: splitCount,
          source: "NONE",
        },
        transportAllowance: 0,
        adjustments: described,
        approvedTotal: approvedSum,
        pendingDelta,
      } satisfies CleanerJobPaySummary;
    }

    // EXACTLY the invoice's per-row derivation (lib/cleaner/invoice.ts): the
    // rework rule overrides the custom-payout meta, then computeCleanerPay.
    const reworkCustomPayout = input.job.isRework
      ? typeof input.job.reworkPayAmount === "number" && Number.isFinite(input.job.reworkPayAmount)
        ? input.job.reworkPayAmount
        : 0
      : undefined;
    const effectiveCustomPayout =
      reworkCustomPayout !== undefined ? reworkCustomPayout : input.cleanerPayouts?.[payeeId];

    const pay = computeCleanerPay(
      { jobType: input.job.jobType, estimatedHours: input.job.estimatedHours },
      { payRate: assignment.payRate, userHourlyRate: assignment.userHourlyRate ?? null },
      { cleanerJobHourlyRates: input.settings.cleanerJobHourlyRates },
      {
        cleanerId: payeeId,
        activeAssignmentCount: splitCount,
        timerHours: Math.max(0, Number(input.timerHoursByCleaner?.[payeeId] ?? 0)),
        customPayout: effectiveCustomPayout,
        transportAllowance: input.transportAllowances?.[payeeId],
        approvedAdjustments: approvedSum,
      }
    );

    return {
      cleanerId: payeeId,
      cleanerName: name,
      cleanerRole: role,
      assigned: true,
      basePay: {
        amount: pay.base,
        basis: pay.payBasis,
        hours: pay.hours,
        rate: pay.rateMissing ? null : pay.rate,
        rateMissing: pay.rateMissing,
        split: pay.split,
        source: pay.source,
      },
      transportAllowance: pay.transportAllowance,
      adjustments: described,
      // pay.total = base + approvedAdjustments + transport — the same figure
      // the cleaner-invoice row and the payroll engine produce for this job.
      approvedTotal: pay.total,
      pendingDelta,
    } satisfies CleanerJobPaySummary;
  });
}
