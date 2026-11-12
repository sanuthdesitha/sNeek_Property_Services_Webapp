/**
 * Types, formatting and period presets for the Predicted (expected invoices)
 * view. Split out of expected-invoices-panel.tsx unchanged.
 */
/* ── Types mirror lib/cleaner/expected-invoice.ts (read-only contract) ──── */
export type ExpectedRow = {
  jobId: string;
  date: string;
  jobName: string;
  property: string;
  jobType: string;
  hours: number;
  originalHours: number;
  isHoursOverridden: boolean;
  hoursChangeNote?: string;
  baseAmount: number;
  approvedExtraAmount: number;
  transportAllowance: number;
  amount: number;
  rateMissing: boolean;
  comment?: string;
};
export type ExpectedSubmission = {
  id: string;
  status: string;
  submittedTotal: number;
  submittedJobCount: number;
  submittedAt: string;
  variance: number | null;
  missingJobs: Array<{ jobId: string; jobName: string; date: string; amount: number }>;
};
export type ExpectedCleaner = {
  cleanerId: string;
  cleanerName: string;
  cleanerEmail: string;
  /** CLEANER or QA_INSPECTOR — inspectors self-invoice on this same rail. */
  role?: string;
  employmentType: string | null;
  expectedTotal: number;
  expectedHours: number;
  jobCount: number;
  overriddenCount: number;
  approvedExtraTotal: number;
  pendingCount: number;
  pendingAmount: number;
  rateMissingCount: number;
  expenseTotal: number;
  shoppingTimeTotal: number;
  qaInspectionTotal?: number;
  qaInspectionCount?: number;
  rows: ExpectedRow[];
  submission: ExpectedSubmission | null;
};
export type ExpectedResult = {
  start: string;
  end: string;
  grandExpectedTotal: number;
  grandPendingAmount: number;
  cleaners: ExpectedCleaner[];
};

/* ── Formatting ────────────────────────────────────────────────────────── */
export const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function money(v: number | null | undefined) {
  return AUD.format(Number(v ?? 0));
}
export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
export function fmtDay(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
export function toISODate(d: Date) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/* ── Employment framing (CONTRACTOR invoices; others are payrolled) ─────── */
export function isContractor(t: string | null) {
  return (t ?? "").toUpperCase() === "CONTRACTOR";
}
export function employmentLabel(t: string | null) {
  if (isContractor(t)) return "Contractor · invoices";
  if (!t) return "Payrolled";
  // e.g. FULL_TIME → "Full time · payrolled"
  const pretty = t
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `${pretty} · payrolled`;
}

/** Variance is "material" (worth admin's eye) at ≥ $1 either way. */
export function varianceOff(v: number | null) {
  return v == null || Math.abs(v) >= 1;
}

/* ── Period presets ─────────────────────────────────────────────────────── */
export type PresetKey = "thisMonth" | "lastMonth" | "last14";
export function presetRange(key: PresetKey): { start: string; end: string } {
  const now = new Date();
  if (key === "thisMonth") {
    return {
      start: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: toISODate(now),
    };
  }
  if (key === "lastMonth") {
    return {
      start: toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end: toISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  // last14 — this fortnight / last 14 days (inclusive of today)
  const back = new Date(now);
  back.setDate(back.getDate() - 13);
  return { start: toISODate(back), end: toISODate(now) };
}

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "last14", label: "Last 14 days" },
];

