"use client";

/**
 * Stage 1 — Accept. The offer card (accept / decline) plus a job summary
 * (date + time window, type, duration, pay when present) and a READ FIRST
 * preview so the cleaner knows what they're taking on before accepting.
 */
import * as React from "react";
import { Clock, CalendarDays, Tag, DollarSign, Megaphone } from "lucide-react";
import { EBadge, ECard, ECardBody } from "@/components/v2/ui/primitives";
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
  const { job, jobTypeLabel, expectedDurationMinutes, formatDurationMinutes, readFirstItems, importantRequests } = api;
  const pay = readPay(api);
  const timeWindow = job?.startTime ? `${job.startTime}${job?.dueTime ? `–${job.dueTime}` : ""}` : null;
  const dateLabel = job?.scheduledDate
    ? new Date(job.scheduledDate).toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short" })
    : null;

  return (
    <div className="space-y-5">
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

      <ECard>
        <ECardBody className="grid grid-cols-2 gap-3 pt-6 sm:grid-cols-4">
          <SummaryCell icon={<CalendarDays className="h-3.5 w-3.5" />} label="Date" value={dateLabel ?? "—"} />
          <SummaryCell icon={<Clock className="h-3.5 w-3.5" />} label="Window" value={timeWindow ?? "—"} />
          <SummaryCell icon={<Tag className="h-3.5 w-3.5" />} label="Type" value={jobTypeLabel} />
          <SummaryCell
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Duration"
            value={expectedDurationMinutes != null ? formatDurationMinutes(expectedDurationMinutes) : "—"}
          />
          {pay != null ? (
            <SummaryCell
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label="Pay"
              value={`$${pay.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
            />
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
        <div className="space-y-2">
          <p className="e-eyebrow">Read first</p>
          <ReadFirstBlock items={readFirstItems.slice(0, 3)} />
        </div>
      ) : null}
    </div>
  );
}

function SummaryCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <p className="flex items-center gap-1 text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
        {icon} {label}
      </p>
      <p className="mt-1 text-[0.875rem] font-[550]">{value}</p>
    </div>
  );
}
