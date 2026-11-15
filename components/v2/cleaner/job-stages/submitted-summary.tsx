"use client";

/**
 * Wrap up after submit (board state D, "After submit"). The form is locked;
 * this shows what the server has recorded: the job status, time on site, the
 * pay for this job from the server (base plus approved adjustments), the
 * adjustments themselves, and the saved laundry update. Laundry says "saved",
 * never "delivered". Nothing here edits anything.
 */
import { tourTarget } from "@/lib/tutorials/targets";
import * as React from "react";
import Link from "next/link";
import { CheckCircle2, HandCoins, Info } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { formatDuration } from "@/lib/time/format-duration";
import { PayAdjustmentList, type PayAdjustmentListItem } from "@/components/v2/shared/pay-adjustment-list";
import { LAUNDRY_OUTCOME_LABELS } from "@/components/v2/cleaner/job-stages/laundry-handoff";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

function finiteOrNull(value: unknown): number | null {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

function fmtAud(amount: number): string {
  return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusPill(status: string): { label: string; tone: "warning" | "aubergine" | "success" | "neutral" } {
  switch (status) {
    case "SUBMITTED":
      return { label: "Submitted", tone: "warning" };
    case "QA_REVIEW":
      return { label: "QA review", tone: "aubergine" };
    case "COMPLETED":
      return { label: "Completed", tone: "success" };
    case "INVOICED":
      return { label: "Invoiced", tone: "success" };
    default:
      return { label: status ? status.toLowerCase().replaceAll("_", " ") : "Status unknown", tone: "neutral" };
  }
}

function Row({ label, detail, value }: { label: string; detail?: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[0.875rem] font-[600]">{label}</p>
        {detail ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{detail}</p> : null}
      </div>
      <div className="shrink-0 text-right text-[0.875rem] font-[600] tabular-nums">{value}</div>
    </div>
  );
}

export function SubmittedSummary({ api }: { api: WorkspaceApi }) {
  const { status, addressLine } = api;
  const onSiteSeconds = Number(api.timeState?.completedSeconds ?? 0);
  // Canonical total (base + approved adjustments) when the API provides it;
  // fall back to the base figure for older payloads.
  const payForJob = finiteOrNull(api.payload?.payTotalForJob) ?? finiteOrNull(api.payload?.payForJob);
  const payAdjustments: PayAdjustmentListItem[] = Array.isArray(api.payload?.payAdjustmentsForJob)
    ? (api.payload.payAdjustmentsForJob as PayAdjustmentListItem[])
    : [];
  const pill = statusPill(status);
  const laundrySaved = api.laundryEnabled && Boolean(api.laundryOutcome);

  return (
    <div className="space-y-4">
      <ECard>
        <ECardBody className="space-y-3 pt-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-[hsl(var(--e-success))]" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="e-serif text-[1.25rem] font-[650] leading-tight">Job submitted</p>
                <EBadge tone={pill.tone} soft>{pill.label}</EBadge>
              </div>
              <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                {api.propertyCode ? `${api.propertyCode} — ` : ""}
                {addressLine || "This job"} is done{status === "COMPLETED" ? " and completed" : ""}.
              </p>
            </div>
          </div>
          <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
            Your quality score is <span className="font-[600]">pending review</span> — you&apos;ll see it in My performance.
          </p>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardBody className="divide-y divide-[hsl(var(--e-border))] pt-1">
          <Row label="Time on site" detail="Recorded by your clock" value={onSiteSeconds > 0 ? formatDuration(onSiteSeconds) : "Not recorded"} />
          <Row
            label="Pay for this job"
            detail="Worked out by the office's pay rules, including approved adjustments"
            value={payForJob != null ? fmtAud(payForJob) : "Not available"}
          />
          {laundrySaved ? (
            <Row
              label={`Laundry: ${LAUNDRY_OUTCOME_LABELS[api.laundryOutcome] ?? api.laundryOutcome}${api.laundryOutcome === "READY_FOR_PICKUP" && api.laundryBagLocation ? `, ${api.laundryBagLocation}` : ""}`}
              detail={`Saved update${api.laundryEarlySentAt ? ` · recorded ${api.laundryEarlySentAt}` : ""} · delivery of the alert to the laundry team is tracked separately`}
              value={<EBadge tone="success" soft>Saved</EBadge>}
            />
          ) : null}
        </ECardBody>
      </ECard>

      {/* Every adjustment that changed this job's pay, read through the same
          canonical summary as the admin card and the invoice. */}
      {payAdjustments.length > 0 ? (
        <ECard>
          <ECardBody className="space-y-1.5 pt-4">
            <p className="e-eyebrow">Pay adjustments on this job</p>
            <PayAdjustmentList items={payAdjustments} variant="self" detailsHref={`/v2/cleaner/pay-requests?jobId=${api.jobId}`} />
          </ECardBody>
        </ECard>
      ) : null}

      <p className="flex items-start gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        The form is locked after submission. Your submitted answers and photos stay on record.
      </p>

      <div className="space-y-2">
        <EButton asChild variant="gold" className="min-h-11 w-full">
          <Link href="/v2/cleaner">Back to Today</Link>
        </EButton>
        <EButton asChild variant="outline" className="min-h-11 w-full">
          <Link {...tourTarget("cleaner.job.extraPay")} href={`/v2/cleaner/pay-requests?jobId=${api.jobId}`}>
            <HandCoins className="h-3.5 w-3.5" aria-hidden /> Request extra pay for this job
          </Link>
        </EButton>
      </div>
    </div>
  );
}
