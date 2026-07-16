"use client";

/**
 * Stage 1 — Accept. The offer card (accept / decline) plus a job summary
 * (date + time window, type, duration, pay when present) and a READ FIRST
 * preview so the cleaner knows what they're taking on before accepting.
 */
import * as React from "react";
import { Megaphone, CheckCircle2, ChevronRight } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
import { ReadFirstBlock } from "@/components/v2/cleaner/read-first-block";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

function readPay(api: WorkspaceApi): number | null {
  const candidates = [
    api.job?.cleanerPayAmount,
    api.job?.payAmount,
    api.job?.cleanerPay,
    api.payload?.jobMeta?.pay,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function StageAccept({ api }: { api: WorkspaceApi }) {
  const {
    job,
    jobTypeLabel,
    expectedDurationMinutes,
    formatDurationMinutes,
    readFirstItems,
    importantRequests,
    needsAcceptance,
    addressLine,
  } = api;
  const pay = readPay(api);
  const timeWindow = job?.startTime ? `${job.startTime}${job?.dueTime ? `–${job.dueTime}` : ""}` : null;
  const dateLabel = job?.scheduledDate
    ? new Date(job.scheduledDate).toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short" })
    : null;
  const whenValue = [dateLabel, timeWindow].filter(Boolean).join(" · ");
  // First read-first item doubles as the "Notes preview" line the design shows.
  const notePreview = readFirstItems[0]?.body?.trim() || readFirstItems[0]?.title?.trim() || null;

  return (
    <div className="space-y-5">
      {needsAcceptance ? (
        <ECard variant="ceremony">
          <ECardBody className="space-y-4 pt-6">
            <div>
              <p className="text-[0.9375rem] font-[600]">You&apos;ve been offered this job</p>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Accept to add it to your schedule, or decline so it can be reassigned.
              </p>
            </div>
            <JobOfferActions jobId={job.id} size="md" onDone={() => api.load()} />
          </ECardBody>
        </ECard>
      ) : null}

      <ECard>
        <ECardBody className="space-y-3 pt-6">
          <p className="e-eyebrow">Job summary</p>
          <dl className="divide-y divide-[hsl(var(--e-border))]">
            <SummaryRow label="When" value={whenValue || "—"} />
            <SummaryRow label="Where" value={addressLine || "—"} wrap />
            <SummaryRow label="Type" value={jobTypeLabel} />
            <SummaryRow
              label="Expected"
              value={expectedDurationMinutes != null ? formatDurationMinutes(expectedDurationMinutes) : "—"}
            />
            {pay != null ? (
              <SummaryRow
                label="Pay"
                value={`$${pay.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
              />
            ) : null}
          </dl>
          {notePreview ? (
            <p className="border-t border-[hsl(var(--e-border))] pt-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              <span className="font-[550] text-[hsl(var(--e-foreground))]">Notes preview: </span>
              {notePreview}
            </p>
          ) : null}
          {!needsAcceptance ? (
            <div className="space-y-3 border-t border-[hsl(var(--e-border))] pt-3">
              <p className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-success))]">
                <CheckCircle2 className="h-4 w-4" /> You accepted this job.
              </p>
              <EButton variant="gold" className="w-full" onClick={() => api.setActiveStage(2)}>
                Continue to Get there <ChevronRight className="h-4 w-4" />
              </EButton>
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      {importantRequests.length > 0 ? (
        <ECard className="border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]">
          <ECardBody className="space-y-2 pt-6">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
                <Megaphone className="h-4 w-4 text-[hsl(var(--e-gold))]" /> Client requests
              </p>
              <EBadge tone="gold" soft>
                {importantRequests.length}
              </EBadge>
            </div>
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              Specific asks flagged for this job — you&apos;ll see the full list once you&apos;re set up.
            </p>
          </ECardBody>
        </ECard>
      ) : null}

      {readFirstItems.length > 0 ? (
        <ReadFirstBlock items={readFirstItems.slice(0, 3)} />
      ) : null}
    </div>
  );
}

function SummaryRow({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
        {label}
      </dt>
      <dd className={`text-right text-[0.875rem] font-[550] ${wrap ? "break-words" : ""}`}>{value}</dd>
    </div>
  );
}
