"use client";

/**
 * The peek panel's sections. Each renders its own loading, failure and empty
 * states; figures that are missing are said to be missing, never shown as 0.
 */
import { useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { toast } from "@/hooks/use-toast";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import type { CleanerSuggestionsResponse, JobPeekSummary } from "@/lib/jobs/peek-types";
import { statusLabel } from "./job-row";
import { assignCleaners } from "./quick-assign-dialog";
import { chargeLabel } from "./jobs-table";
import type { Loadable, PeekPaySummary, PeekTimeline } from "./use-job-peek";

function when(value: string | null, pattern: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return formatInTimeZone(new Date(value), SYDNEY_TZ, pattern);
}

function dayLabel(dayKey: string): string {
  return formatInTimeZone(new Date(`${dayKey}T12:00:00Z`), SYDNEY_TZ, "EEE d MMM");
}

export function SectionState<T>({ value, label, onRetry }: { value: Loadable<T>; label: string; onRetry?: () => void }) {
  if (value.status === "loading" || value.status === "idle") return <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading {label}…</p>;
  if (value.status === "error") {
    return (
      <div role="alert" className="space-y-2 text-[0.8125rem]">
        <p>{value.error}</p>
        {onRetry ? <EButton size="sm" variant="outline" onClick={onRetry}>Try again</EButton> : null}
      </div>
    );
  }
  return null;
}

const DL = "grid grid-cols-[110px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[0.8125rem] [&_dt]:text-[hsl(var(--e-muted-foreground))]";

export function PeekSummaryList({ summary }: { summary: JobPeekSummary }) {
  const departing = summary.departing;
  const arriving = summary.arriving;
  const arrivingTime = when(arriving?.checkinAt ?? null, "HH:mm");
  const laundry = summary.laundry;
  return (
    <dl className={DL}>
      <dt>Client</dt>
      <dd>{summary.client?.name ?? "No client"}</dd>
      <dt>Departing</dt>
      <dd>
        {departing && (departing.name || departing.phoneLabel) ? (
          <>
            {departing.name ?? "Guest name not given"}
            {departing.phoneLabel ? <> · {departing.phoneHref ? <a href={`tel:${departing.phoneHref}`} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">{departing.phoneLabel}</a> : departing.phoneLabel}</> : null}
          </>
        ) : <span className="text-[hsl(var(--e-muted-foreground))]">No booking linked</span>}
      </dd>
      <dt>Arriving</dt>
      <dd>
        {arriving ? (
          <>
            {arrivingTime ?? "Time not given"}
            {arriving.sameDay ? " same day" : ""}
            {arriving.guestCountLabel ? ` · ${arriving.guestCountLabel}` : ""}
            {arriving.name ? ` · ${arriving.name}` : ""}
          </>
        ) : <span className="text-[hsl(var(--e-muted-foreground))]">No arriving guest recorded</span>}
      </dd>
      <dt>Laundry</dt>
      <dd>
        {laundry ? (
          laundry.noPickupRequired ? "No pickup required" : (
            <>{statusLabelForLaundry(laundry.status)} · pickup {dayLabel(laundry.pickupDate)}, return {dayLabel(laundry.dropoffDate)}</>
          )
        ) : <span className="text-[hsl(var(--e-muted-foreground))]">No laundry task</span>}
      </dd>
      <dt>Charge</dt>
      <dd className="e-tnum">
        {summary.charge.missing || summary.charge.amount === null ? <EPill tone="warn">No rate</EPill> : chargeLabel(summary.charge.amount)}
      </dd>
    </dl>
  );
}

function statusLabelForLaundry(status: string): string {
  const text = status.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function PeekSuggestions({ jobId, value, onAssigned, readOnly }: {
  jobId: string; value: Loadable<CleanerSuggestionsResponse>; onAssigned: () => void; readOnly: boolean;
}) {
  const [assigning, setAssigning] = useState<string | null>(null);
  async function assign(cleanerId: string, name: string) {
    setAssigning(cleanerId);
    try {
      await assignCleaners(jobId, [cleanerId]);
      toast({ title: "Assigned", description: `${name} is on this job.` });
      onAssigned();
    } catch (error) {
      toast({ title: "Assign failed", description: error instanceof Error ? error.message : "Could not assign job.", variant: "destructive" });
    } finally {
      setAssigning(null);
    }
  }
  return (
    <section aria-labelledby="peek-suggestions" className="space-y-2">
      <EEyebrow id="peek-suggestions">Suggested cleaners</EEyebrow>
      <SectionState value={value} label="suggestions" />
      {value.status === "success" && value.data?.kind === "assigned" ? <p className="text-[0.8125rem]">{value.data.reason}</p> : null}
      {value.status === "success" && value.data?.kind === "ok" ? (
        value.data.suggestions.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active cleaners to suggest.</p>
        ) : (
          <ul className="space-y-2">
            {value.data.suggestions.map((row, index) => (
              <li key={row.cleanerId} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-[600]">{row.name}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.reasons.join(" · ")}</p>
                </div>
                {row.assignable ? (
                  <EButton size="sm" variant={index === 0 ? "primary" : "outline"} disabled={readOnly || assigning !== null}
                    aria-label={`Assign ${row.name}`} onClick={() => void assign(row.cleanerId, row.name)}>
                    {assigning === row.cleanerId ? "Assigning…" : "Assign"}
                  </EButton>
                ) : (
                  <EButton size="sm" variant="outline" disabled title={row.blocker?.reason} aria-label={`${row.name}: ${row.blocker?.reason ?? "not available"}`}>
                    {row.blocker?.kind === "clash" ? "Clash" : "Unavailable"}
                  </EButton>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

export function PeekPeople({ summary }: { summary: JobPeekSummary }) {
  return (
    <dl className={DL}>
      <dt>Cleaners</dt>
      <dd>
        {summary.assignments.length === 0 ? <span className="text-[hsl(var(--e-muted-foreground))]">Nobody assigned</span> : (
          <ul>{summary.assignments.map((row) => (
            <li key={row.userId}>{row.name}{row.isPrimary ? " (primary)" : ""} · {row.responseStatus === "PENDING" ? "awaiting reply" : row.responseStatus.toLowerCase()}</li>
          ))}</ul>
        )}
      </dd>
      <dt>QA</dt>
      <dd>{summary.qa ? `${summary.qa.inspector ?? "Unassigned inspector"} · ${summary.qa.status.toLowerCase().replace(/_/g, " ")}` : <span className="text-[hsl(var(--e-muted-foreground))]">No active inspection</span>}</dd>
      <dt>Status</dt>
      <dd>{statusLabel(summary.status)}</dd>
    </dl>
  );
}

export function PeekMoney({ summary, value, onRetry }: { summary: JobPeekSummary; value: Loadable<PeekPaySummary>; onRetry: () => void }) {
  return (
    <div className="space-y-3 text-[0.8125rem]">
      <dl className={DL}>
        <dt>Client charge</dt>
        <dd className="e-tnum">{summary.charge.missing || summary.charge.amount === null ? <EPill tone="warn">No rate</EPill> : chargeLabel(summary.charge.amount)}</dd>
      </dl>
      <SectionState value={value} label="cleaner pay" onRetry={onRetry} />
      {value.status === "success" && value.data ? (
        value.data.payees.length === 0 ? <p className="text-[hsl(var(--e-muted-foreground))]">No cleaner pay recorded yet.</p> : (
          <ul className="space-y-1.5">
            {value.data.payees.map((payee) => (
              <li key={payee.cleanerId} className="flex flex-wrap items-center justify-between gap-2">
                <span>{payee.cleanerName}</span>
                <span className="e-tnum flex items-center gap-1.5">
                  {chargeLabel(payee.approvedTotal)}
                  {payee.basePay.rateMissing ? <EPill tone="warn">Rate not set</EPill> : null}
                  {payee.pendingDelta !== 0 ? <EPill tone="info">{payee.pendingDelta > 0 ? "+" : "−"}{chargeLabel(Math.abs(payee.pendingDelta))} pending</EPill> : null}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

export function PeekActivity({ value, onRetry }: { value: Loadable<PeekTimeline>; onRetry: () => void }) {
  return (
    <div className="space-y-2 text-[0.8125rem]">
      <SectionState value={value} label="activity" onRetry={onRetry} />
      {value.status === "success" && value.data ? (
        value.data.length === 0 ? <p className="text-[hsl(var(--e-muted-foreground))]">No activity recorded.</p> : (
          <ol className="space-y-2">
            {value.data.slice(0, 30).map((event) => (
              <li key={event.id}>
                <p className="font-[550]">{event.title}</p>
                <p className="text-[hsl(var(--e-muted-foreground))]">
                  {when(event.at, "d MMM HH:mm") ?? "Time unknown"}{event.actorName ? ` · ${event.actorName}` : ""}{event.detail ? ` · ${event.detail}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}
