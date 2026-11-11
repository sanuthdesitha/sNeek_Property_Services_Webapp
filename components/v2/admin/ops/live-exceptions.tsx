"use client";

/**
 * Live ops exceptions, each with its actions:
 * - Late → Call (tel), Message (the job's Messages tab), Tell client (the same
 *   tab: client messages live there; no delay notice is sent from here),
 *   Reassign (shared Jobs peek panel).
 * - Continuation request → Approve / Decline through the existing endpoint.
 * - Off site with the clock running → Call, Review clock (the job's Activity
 *   tab, where clock records are edited; there is no admin pause endpoint).
 * - Not started past start time → Call, Reassign.
 */
import { useState } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { jobTabHref } from "@/lib/dashboard/work-queue-links";
import type { LiveContinuationRow, LiveJobRow } from "@/lib/ops/live-board-types";
import { decideContinuation, type ContinuationDecision } from "./continuation-decision";

type ExceptionProps = {
  jobs: LiveJobRow[];
  continuations: LiveContinuationRow[];
  readOnly: boolean;
  onReassign: (jobId: string) => void;
  onSelect: (userId: string) => void;
  onDecided: () => void;
};

const ROW = "flex flex-col gap-2.5 border-b border-[hsl(var(--e-border))] px-4 py-3.5";

function who(job: LiveJobRow): string {
  return job.cleaners.map((c) => c.name).join(", ") || "No cleaner";
}

function CallButton({ job }: { job: LiveJobRow }) {
  const phone = job.cleaners.find((c) => c.phone)?.phone;
  if (!phone) return <EButton size="sm" variant="outline" disabled title="No phone number on the account">Call</EButton>;
  return <EButton asChild size="sm" variant="outline"><a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>Call</a></EButton>;
}

function Heading({ job, badge, tone, onSelect }: { job: LiveJobRow; badge: string; tone: "bad" | "warn"; onSelect: (userId: string) => void }) {
  const first = job.cleaners[0];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {first ? (
        <button type="button" onClick={() => onSelect(first.id)} className="min-w-0 text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
          {who(job)} · {job.propertyName}
        </button>
      ) : <b className="min-w-0">{who(job)} · {job.propertyName}</b>}
      <EPill tone={tone}>{badge}</EPill>
    </div>
  );
}

function guestNote(job: LiveJobRow): string {
  return job.sameDayCheckinTime ? ` Guest arrives ${job.sameDayCheckinTime}.` : "";
}

function ContinuationRow({ row, readOnly, onDecided }: { row: LiveContinuationRow; readOnly: boolean; onDecided: () => void }) {
  const [pending, setPending] = useState<ContinuationDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function decide(decision: ContinuationDecision) {
    setPending(decision);
    setError(null);
    const result = await decideContinuation(row.id, decision);
    setPending(null);
    if (result.ok) {
      setDone(decision === "APPROVE" ? "Approved" : "Declined");
      onDecided();
    } else setError(result.message);
  }
  return (
    <li className={ROW}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/v2/admin/jobs/${row.jobId}`} className="font-[600] text-inherit hover:underline">{row.cleanerName} · {row.propertyName}</Link>
        <EPill tone="warn">Wants to continue later</EPill>
      </div>
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        {row.remainingHours != null ? `${row.remainingHours} h left. ` : ""}{row.reason ? `“${row.reason}”` : "No reason given."}
      </p>
      {error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {done ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-success))]">{done}. Updating…</p> : readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          <EButton size="sm" variant="outline" disabled={pending !== null} onClick={() => void decide("REJECT")}>{pending === "REJECT" ? "Declining…" : "Decline"}</EButton>
          <EButton size="sm" disabled={pending !== null} onClick={() => void decide("APPROVE")}>{pending === "APPROVE" ? "Approving…" : "Approve"}</EButton>
        </div>
      )}
    </li>
  );
}

export function LiveExceptions({ jobs, continuations, readOnly, onReassign, onSelect, onDecided }: ExceptionProps) {
  const late = jobs.filter((job) => job.state === "late").sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0));
  const offSite = jobs.filter((job) => job.state === "off-site");
  const notStarted = jobs.filter((job) => job.state === "not-started").sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0));
  if (late.length + offSite.length + notStarted.length + continuations.length === 0) {
    return <p className="px-4 py-8 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No exceptions right now.</p>;
  }
  return (
    <ul aria-label="Exceptions">
      {late.map((job) => (
        <li key={`late:${job.jobId}`} className={`${ROW} bg-[hsl(var(--e-danger-soft))]`}>
          <Heading job={job} badge={`${job.minutes} min late`} tone="bad" onSelect={onSelect} />
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Due {job.startTime}, still travelling{job.etaClock ? `, ETA ${job.etaClock}` : ", no ETA recorded"}.{guestNote(job)}</p>
          <div className="flex flex-wrap gap-2">
            <CallButton job={job} />
            <EButton asChild size="sm" variant="outline"><Link href={jobTabHref(job.jobId, "messages")}>Message</Link></EButton>
            <EButton asChild size="sm" variant="outline"><Link href={jobTabHref(job.jobId, "messages")} title="Opens the job's client messages">Tell client</Link></EButton>
            {readOnly ? null : <EButton size="sm" onClick={() => onReassign(job.jobId)}>Reassign</EButton>}
          </div>
        </li>
      ))}
      {continuations.map((row) => <ContinuationRow key={row.id} row={row} readOnly={readOnly} onDecided={onDecided} />)}
      {offSite.map((job) => (
        <li key={`off:${job.jobId}`} className={ROW}>
          <Heading job={job} badge="Left site, clock running" tone="warn" onSelect={onSelect} />
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {job.distanceMeters != null ? `${job.distanceMeters} m from the property` : "Outside the property's geofence"}
            {job.minutes != null ? ` for ${job.minutes} minutes.` : "."}
          </p>
          <div className="flex flex-wrap gap-2">
            <CallButton job={job} />
            <EButton asChild size="sm" variant="outline"><Link href={jobTabHref(job.jobId, "activity")}>Review clock</Link></EButton>
          </div>
        </li>
      ))}
      {notStarted.map((job) => (
        <li key={`ns:${job.jobId}`} className={ROW}>
          <Heading job={job} badge={`Not started, ${job.minutes} min past start`} tone="warn" onSelect={onSelect} />
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Start {job.startTime}; not on the way or clocked in.{guestNote(job)}</p>
          <div className="flex flex-wrap gap-2">
            {job.cleaners.length > 0 ? <CallButton job={job} /> : null}
            {readOnly ? null : <EButton size="sm" onClick={() => onReassign(job.jobId)}>{job.cleaners.length > 0 ? "Reassign" : "Assign"}</EButton>}
          </div>
        </li>
      ))}
    </ul>
  );
}
