"use client";

/**
 * ESTATE-native "cleaner invoice PREDICTION" surface.
 *
 * Predicts what each ACTIVE cleaner will invoice for a pay period BEFORE they
 * submit, so admin can (a) see the money to prepare for payday and (b) review
 * each expected invoice for transparency (overridden hours, pending vs approved
 * extras, missing rates). Once a cleaner submits, it reconciles submitted-vs-
 * expected (variance + jobs they forgot to add).
 *
 * Read-only. Data comes ENTIRELY from the existing endpoint:
 *   GET /api/admin/cleaner-invoices/expected?start=YYYY-MM-DD&end=YYYY-MM-DD
 * (optional &cleanerId=). Response shape = ExpectedInvoicesResult from
 * lib/cleaner/expected-invoice.ts. No API/lib changes.
 */
import * as React from "react";
import Link from "next/link";
import {
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Clock,
  Wallet,
  Users,
  GitCompareArrows,
  ExternalLink,
  ArrowUpRight,
  ReceiptText,
  ShoppingBag,
} from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ETableShell } from "@/components/v2/admin/estate-kit";

/* ── Types mirror lib/cleaner/expected-invoice.ts (read-only contract) ──── */
type ExpectedRow = {
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
type ExpectedSubmission = {
  id: string;
  status: string;
  submittedTotal: number;
  submittedJobCount: number;
  submittedAt: string;
  variance: number;
  missingJobs: Array<{ jobId: string; jobName: string; date: string; amount: number }>;
};
type ExpectedCleaner = {
  cleanerId: string;
  cleanerName: string;
  cleanerEmail: string;
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
  rows: ExpectedRow[];
  submission: ExpectedSubmission | null;
};
type ExpectedResult = {
  start: string;
  end: string;
  grandExpectedTotal: number;
  grandPendingAmount: number;
  cleaners: ExpectedCleaner[];
};

/* ── Formatting ────────────────────────────────────────────────────────── */
const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function money(v: number | null | undefined) {
  return AUD.format(Number(v ?? 0));
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDay(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
function toISODate(d: Date) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/* ── Employment framing (CONTRACTOR invoices; others are payrolled) ─────── */
function isContractor(t: string | null) {
  return (t ?? "").toUpperCase() === "CONTRACTOR";
}
function employmentLabel(t: string | null) {
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
function varianceOff(v: number) {
  return Math.abs(v) >= 1;
}

/* ── Period presets ─────────────────────────────────────────────────────── */
type PresetKey = "thisMonth" | "lastMonth" | "last14";
function presetRange(key: PresetKey): { start: string; end: string } {
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

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "last14", label: "Last 14 days" },
];

/* ── Panel ─────────────────────────────────────────────────────────────── */
export function ExpectedInvoicesPanel() {
  const initial = React.useMemo(() => presetRange("thisMonth"), []);
  // `range` = the applied window that drives fetches; the inputs edit a draft.
  const [range, setRange] = React.useState({ start: initial.start, end: initial.end });
  const [draftStart, setDraftStart] = React.useState(initial.start);
  const [draftEnd, setDraftEnd] = React.useState(initial.end);

  const [data, setData] = React.useState<ExpectedResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const activePreset = React.useMemo<PresetKey | null>(() => {
    for (const p of PRESETS) {
      const r = presetRange(p.key);
      if (r.start === range.start && r.end === range.end) return p.key;
    }
    return null;
  }, [range]);

  const load = React.useCallback(async (start: string, end: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ start, end });
      const res = await fetch(`/api/admin/cleaner-invoices/expected?${qs.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "Could not compute expected invoices.");
        setData(null);
        return;
      }
      setData(body as ExpectedResult);
    } catch (e: any) {
      setError(e?.message || "Network error while loading the prediction.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load(range.start, range.end);
  }, [range, load]);

  function applyPreset(key: PresetKey) {
    const r = presetRange(key);
    setDraftStart(r.start);
    setDraftEnd(r.end);
    setRange(r);
  }
  function applyDraft() {
    if (!draftStart || !draftEnd) return;
    // Guard against inverted ranges — swap so the fetch is always start ≤ end.
    const [s, e] = draftStart <= draftEnd ? [draftStart, draftEnd] : [draftEnd, draftStart];
    setDraftStart(s);
    setDraftEnd(e);
    setRange({ start: s, end: e });
  }

  const cleaners = data?.cleaners ?? [];

  // Count of cleaners whose submission is materially off OR who forgot jobs.
  const flaggedReconciliations = React.useMemo(
    () =>
      cleaners.filter(
        (c) =>
          c.submission &&
          (varianceOff(c.submission.variance) || c.submission.missingJobs.length > 0)
      ).length,
    [cleaners]
  );

  function toggle(id: string) {
    setExpanded((m) => ({ ...m, [id]: !m[id] }));
  }

  return (
    <div className="space-y-6">
      {/* ── Period selector ───────────────────────────────────────────── */}
      <ECard>
        <ECardBody className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => {
                const active = activePreset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p.key)}
                    className={`rounded-[var(--e-radius-pill)] px-3 py-1 text-[0.75rem] font-medium transition-colors ${
                      active
                        ? "bg-[hsl(var(--e-foreground))] text-[hsl(var(--e-background))]"
                        : "border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <EButton variant="outline" size="sm" onClick={() => load(range.start, range.end)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </EButton>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <EField label="From" className="w-full sm:w-auto">
              <EInput
                type="date"
                value={draftStart}
                max={draftEnd || undefined}
                onChange={(e) => setDraftStart(e.target.value)}
                className="sm:w-[10.5rem]"
              />
            </EField>
            <EField label="To" className="w-full sm:w-auto">
              <EInput
                type="date"
                value={draftEnd}
                min={draftStart || undefined}
                onChange={(e) => setDraftEnd(e.target.value)}
                className="sm:w-[10.5rem]"
              />
            </EField>
            <EButton variant="gold" size="md" onClick={applyDraft} disabled={loading || !draftStart || !draftEnd}>
              Apply
            </EButton>
          </div>

          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Predicting the window{" "}
            <span className="font-medium text-[hsl(var(--e-foreground))]">
              {fmtDate(data?.start ?? range.start)} → {fmtDate(data?.end ?? range.end)}
            </span>
            . Only unpaid jobs count, so this is money genuinely upcoming.
          </p>
        </ECardBody>
      </ECard>

      {/* ── Summary strip ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard
          label="Money to prepare"
          value={money(data?.grandExpectedTotal)}
          icon={<Wallet className="h-4 w-4" />}
        />
        <EStatCard
          label="Pending (unapproved) extras"
          value={money(data?.grandPendingAmount)}
          delta={data && data.grandPendingAmount > 0 ? "Awaiting approval — not in total" : undefined}
          deltaTone="neutral"
          icon={<Clock className="h-4 w-4" />}
        />
        <EStatCard
          label="Cleaners with activity"
          value={cleaners.length}
          icon={<Users className="h-4 w-4" />}
        />
        <EStatCard
          label="Reconciliations to review"
          value={flaggedReconciliations}
          delta={flaggedReconciliations > 0 ? "Submitted totals differ from expected" : undefined}
          deltaTone={flaggedReconciliations > 0 ? "danger" : "neutral"}
          icon={<GitCompareArrows className="h-4 w-4" />}
        />
      </section>

      {/* ── States ────────────────────────────────────────────────────── */}
      {error ? (
        <EAlert tone="danger" title="Couldn't load the prediction">
          <div className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <EButton variant="outline" size="sm" onClick={() => load(range.start, range.end)}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </EButton>
          </div>
        </EAlert>
      ) : loading && !data ? (
        <ECard>
          <ECardBody className="flex items-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Predicting cleaner invoices…
          </ECardBody>
        </ECard>
      ) : cleaners.length === 0 ? (
        <EEmptyState
          eyebrow="Predicted invoices"
          title="No expected invoices in this window"
          description="No active cleaner has unpaid jobs, expenses or pending extras for the selected period. Try a wider range or a different month."
        />
      ) : (
        <div className="space-y-4">
          {loading ? (
            <p className="flex items-center gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Refreshing…
            </p>
          ) : null}
          {cleaners.map((c) => (
            <CleanerCard
              key={c.cleanerId}
              cleaner={c}
              open={!!expanded[c.cleanerId]}
              onToggle={() => toggle(c.cleanerId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Per-cleaner card ──────────────────────────────────────────────────── */
function CleanerCard({
  cleaner: c,
  open,
  onToggle,
}: {
  cleaner: ExpectedCleaner;
  open: boolean;
  onToggle: () => void;
}) {
  const contractor = isContractor(c.employmentType);
  const understated = c.rateMissingCount > 0;

  return (
    <ECard>
      <ECardBody className="space-y-4 p-5">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/v2/admin/accounts/users/${c.cleanerId}`}
                className="group inline-flex items-center gap-1 text-[1.0625rem] font-semibold tracking-[-0.01em] text-[hsl(var(--e-foreground))] hover:text-[hsl(var(--e-gold-ink))]"
              >
                {c.cleanerName}
                <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
              <EBadge tone={contractor ? "gold" : "neutral"} soft>
                {employmentLabel(c.employmentType)}
              </EBadge>
            </div>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{c.cleanerEmail}</p>
          </div>

          <div className="text-right">
            <p className="e-eyebrow">Expected total</p>
            <p className="e-numeral text-[1.75rem] leading-none">{money(c.expectedTotal)}</p>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {c.jobCount} {c.jobCount === 1 ? "job" : "jobs"} · {c.expectedHours.toFixed(2)} hrs
            </p>
          </div>
        </div>

        {/* Flag chips */}
        <div className="flex flex-wrap items-center gap-2">
          {understated ? (
            <EBadge tone="danger" soft>
              <AlertTriangle className="h-3 w-3" /> {c.rateMissingCount} missing rate
              {c.rateMissingCount === 1 ? "" : "s"} · total understated
            </EBadge>
          ) : null}
          {c.pendingCount > 0 ? (
            <EBadge tone="warning" soft>
              <Clock className="h-3 w-3" /> {c.pendingCount} pending extra
              {c.pendingCount === 1 ? "" : "s"} · {money(c.pendingAmount)} (not in total)
            </EBadge>
          ) : null}
          {c.overriddenCount > 0 ? (
            <EBadge tone="info" soft>
              {c.overriddenCount} hours overridden
            </EBadge>
          ) : null}
          {c.approvedExtraTotal > 0 ? (
            <EBadge tone="success" soft>
              +{money(c.approvedExtraTotal)} approved extras
            </EBadge>
          ) : null}
          {c.expenseTotal > 0 ? (
            <EBadge tone="neutral" soft>
              <ReceiptText className="h-3 w-3" /> {money(c.expenseTotal)} expenses
            </EBadge>
          ) : null}
          {c.shoppingTimeTotal > 0 ? (
            <EBadge tone="neutral" soft>
              <ShoppingBag className="h-3 w-3" /> {money(c.shoppingTimeTotal)} shopping time
            </EBadge>
          ) : null}
        </div>

        {/* Submission reconciliation */}
        <SubmissionBlock submission={c.submission} />

        {/* Expand toggle */}
        <div className="flex items-center justify-between border-t border-[hsl(var(--e-border))] pt-3">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-text-secondary))] transition-colors hover:text-[hsl(var(--e-foreground))]"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {open ? "Hide" : "Show"} {c.rows.length} job line{c.rows.length === 1 ? "" : "s"}
          </button>
        </div>

        {open ? <JobLines rows={c.rows} /> : null}
      </ECardBody>
    </ECard>
  );
}

/* ── Submission reconciliation block ───────────────────────────────────── */
function SubmissionBlock({ submission }: { submission: ExpectedSubmission | null }) {
  if (!submission) {
    return (
      <p className="text-[0.75rem] italic text-[hsl(var(--e-text-faint))]">
        Not yet submitted — this is a prediction only.
      </p>
    );
  }

  const off = varianceOff(submission.variance);
  const hasMissing = submission.missingJobs.length > 0;
  const tone: "success" | "warning" = off || hasMissing ? "warning" : "success";
  const variancePrefix = submission.variance > 0 ? "+" : "";

  return (
    <EAlert
      tone={tone}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <GitCompareArrows className="h-4 w-4" />
          Submitted {money(submission.submittedTotal)} · {submission.submittedJobCount} job
          {submission.submittedJobCount === 1 ? "" : "s"}
          <EBadge tone={tone === "success" ? "success" : "warning"} soft>
            {tone === "success"
              ? "Lines up with expected"
              : `Variance ${variancePrefix}${money(submission.variance)} vs expected`}
          </EBadge>
        </span>
      }
    >
      <div className="space-y-1.5">
        <p>
          Status <span className="font-medium text-[hsl(var(--e-foreground))]">{submission.status}</span> ·
          submitted {fmtDate(submission.submittedAt)}.
          {tone === "success"
            ? " Submitted total matches what we expected."
            : " Review the difference before paying."}
        </p>
        {hasMissing ? (
          <div>
            <p className="font-medium text-[hsl(var(--e-foreground))]">
              {submission.missingJobs.length} job
              {submission.missingJobs.length === 1 ? "" : "s"} on our prediction but not in their
              submission (possibly forgotten):
            </p>
            <ul className="mt-1 space-y-0.5">
              {submission.missingJobs.map((j) => (
                <li key={j.jobId} className="flex items-center gap-1.5">
                  <Link
                    href={`/v2/admin/jobs/${j.jobId}`}
                    className="inline-flex items-center gap-1 text-[hsl(var(--e-gold-ink))] hover:underline"
                  >
                    {j.jobName}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  <span className="text-[hsl(var(--e-muted-foreground))]">
                    · {fmtDay(j.date)} · {money(j.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </EAlert>
  );
}

/* ── Expandable job-line table ─────────────────────────────────────────── */
function JobLines({ rows }: { rows: ExpectedRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        No job lines — this cleaner's expected total comes from expenses / shopping time only.
      </p>
    );
  }
  return (
    <ETableShell
      headers={[
        { label: "Date" },
        { label: "Job / property" },
        { label: "Type" },
        { label: "Hours", align: "right" },
        { label: "Base", align: "right" },
        { label: "Extra", align: "right" },
        { label: "Transport", align: "right" },
        { label: "Line", align: "right" },
      ]}
    >
      {rows.map((r) => (
        <tr key={r.jobId} className="align-top">
          <td className="whitespace-nowrap px-4 py-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {fmtDay(r.date)}
          </td>
          <td className="px-4 py-3">
            <Link
              href={`/v2/admin/jobs/${r.jobId}`}
              className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))] hover:text-[hsl(var(--e-gold-ink))]"
            >
              {r.jobName}
              <ExternalLink className="h-3 w-3 opacity-50" />
            </Link>
            <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{r.property}</p>
            {r.comment ? (
              <p className="mt-0.5 text-[0.6875rem] italic text-[hsl(var(--e-text-faint))]">
                “{r.comment}”
              </p>
            ) : null}
          </td>
          <td className="px-4 py-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{r.jobType}</td>
          <td className="px-4 py-3 text-right text-[0.8125rem]">
            {r.isHoursOverridden ? (
              <span className="inline-flex flex-col items-end leading-tight">
                <span className="font-medium">{r.hours.toFixed(2)}</span>
                <span className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))] line-through">
                  {r.originalHours.toFixed(2)}
                </span>
                {r.hoursChangeNote ? (
                  <span
                    className="text-[0.625rem] italic text-[hsl(var(--e-text-faint))]"
                    title={r.hoursChangeNote}
                  >
                    edited
                  </span>
                ) : null}
              </span>
            ) : (
              r.hours.toFixed(2)
            )}
          </td>
          <td className="px-4 py-3 text-right text-[0.8125rem]">{money(r.baseAmount)}</td>
          <td className="px-4 py-3 text-right text-[0.8125rem]">
            {r.approvedExtraAmount ? money(r.approvedExtraAmount) : "—"}
          </td>
          <td className="px-4 py-3 text-right text-[0.8125rem]">
            {r.transportAllowance ? money(r.transportAllowance) : "—"}
          </td>
          <td className="px-4 py-3 text-right">
            <span className="e-serif text-[0.875rem]">{money(r.amount)}</span>
            {r.rateMissing ? (
              <span
                className="ml-1 inline-flex items-center text-[hsl(var(--e-danger))]"
                title="No pay rate set for this job — expected total understates until the rate is fixed."
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </td>
        </tr>
      ))}
    </ETableShell>
  );
}
