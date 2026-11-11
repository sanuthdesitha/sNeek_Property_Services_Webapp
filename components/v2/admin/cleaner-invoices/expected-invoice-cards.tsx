"use client";

/**
 * The Predicted view's per-cleaner card, its submitted-vs-expected block and
 * the expandable job lines. Split out of expected-invoices-panel.tsx
 * unchanged; the review page reuses SubmissionBlock.
 */
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Clock,
  GitCompareArrows,
  ExternalLink,
  ArrowUpRight,
  ReceiptText,
  ShoppingBag,
} from "lucide-react";
import { EAlert, EBadge, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import {
  employmentLabel,
  fmtDate,
  fmtDay,
  isContractor,
  money,
  varianceOff,
  type ExpectedCleaner,
  type ExpectedRow,
  type ExpectedSubmission,
} from "./expected-invoice-model";

/* ── Per-cleaner card ──────────────────────────────────────────────────── */
export function CleanerCard({
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
              {/* An inspections-only payee has zero job lines, so without this
                  their row reads like a cleaner who did nothing. */}
              {c.role === "QA_INSPECTOR" ? (
                <EBadge tone="info" soft>
                  QA inspector
                </EBadge>
              ) : null}
            </div>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{c.cleanerEmail}</p>
          </div>

          <div className="text-right">
            <p className="e-eyebrow">Expected total</p>
            <p className="e-numeral text-[1.75rem] leading-none">{money(c.expectedTotal)}</p>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {c.jobCount} {c.jobCount === 1 ? "job" : "jobs"} · {c.expectedHours.toFixed(2)} hrs
              {Number(c.qaInspectionCount ?? 0) > 0
                ? ` · ${c.qaInspectionCount} QA ${
                    c.qaInspectionCount === 1 ? "inspection" : "inspections"
                  } (${money(Number(c.qaInspectionTotal ?? 0))})`
                : ""}
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
export function SubmissionBlock({ submission }: { submission: ExpectedSubmission | null }) {
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
  const variancePrefix = (submission.variance ?? 0) > 0 ? "+" : "";

  return (
    <EAlert
      tone={tone}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <GitCompareArrows className="h-4 w-4" />
          Submitted {money(submission.submittedTotal)} · {submission.submittedJobCount} job
          {submission.submittedJobCount === 1 ? "" : "s"}
          <EBadge tone={tone === "success" ? "success" : "warning"} soft>
            {submission.variance == null ? "Manual reconciliation required" : tone === "success"
              ? "Lines up with expected"
              : `Variance ${variancePrefix}${money(submission.variance ?? 0)} vs expected`}
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
export function JobLines({ rows }: { rows: ExpectedRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        No job lines — this cleaner&apos;s expected total comes from expenses / shopping time only.
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
            {/* Universal edit-or-navigate rule: this figure is the sum of the
                job's approved adjustments, so it links to the job's canonical
                "Cleaner pay" card where each one is listed and editable. */}
            {r.approvedExtraAmount ? (
              <Link
                href={`/v2/admin/jobs/${r.jobId}`}
                title="See and edit every adjustment behind this figure"
                className="inline-flex items-center gap-1 hover:text-[hsl(var(--e-gold-ink))]"
              >
                {money(r.approvedExtraAmount)}
                <ExternalLink className="h-3 w-3 opacity-50" />
              </Link>
            ) : (
              "—"
            )}
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
