"use client";

/**
 * Live ops exceptions, each with its actions:
 * - Late → Call (tel), Message (the job's Messages tab), Tell client (as
 *   drawn; ADMIN, or OPS_MANAGER with the Jobs pack: confirm dialog over the
 *   client delay notice route; others
 *   keep a "Tell client" link to the Messages tab), Reassign (Jobs peek panel).
 *   A notice already requested today shows on the row (time, who).
 * - Continuation request → Approve, or Decline with the required reason
 *   (shared DeclineReasonDialog, also used by Command's work queue).
 * - Off site with the clock running → Call, Pause clock (same rule: dialog over
 *   POST /api/admin/jobs/[id]/pause-clock), Review clock (the job's Activity tab).
 * - Not started past start time → Call, Reassign.
 *
 * Phone (below 640px): each row keeps its main fix on the card (late: Call and
 * Tell client; off site: Call and Pause clock) and the rest of the SAME
 * actions under "More" in a bottom sheet. From 640px up the rows are unchanged.
 */
import { useState } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { jobTabHref } from "@/lib/dashboard/work-queue-links";
import type { LiveContinuationRow, LiveJobRow } from "@/lib/ops/live-board-types";
import { DeclineReasonDialog } from "../office-actions/decline-reason-dialog";
import { decideContinuation, type ContinuationDecision } from "./continuation-decision";
import { DelayNoticeDialog } from "./delay-notice-dialog";
import { PauseClockDialog } from "./pause-clock-dialog";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { PhoneActionSheet } from "@/components/v2/admin/phone-action-sheet";
import type { ERowMenuItem } from "@/components/v2/ui/row-menu";

type ExceptionProps = {
  jobs: LiveJobRow[];
  continuations: LiveContinuationRow[];
  readOnly: boolean;
  /** Notify client: ADMIN, or OPS_MANAGER with the Jobs pack at manage; not impersonating (as the route allows). */
  canNotifyClient?: boolean;
  /** Pause clock: the same rule, as its route allows. */
  canPauseClock?: boolean;
  todayKey?: string;
  timeZone?: string;
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
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function approve() {
    setPending("APPROVE");
    setError(null);
    const result = await decideContinuation(row.id, "APPROVE");
    setPending(null);
    if (result.ok) {
      setDone("Approved");
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
          <EButton size="sm" variant="outline" disabled={pending !== null} onClick={() => setDeclining(true)}>Decline</EButton>
          <EButton size="sm" disabled={pending !== null} onClick={() => void approve()}>{pending === "APPROVE" ? "Approving…" : "Approve"}</EButton>
        </div>
      )}
      <DeclineReasonDialog
        open={declining}
        subject={`${row.cleanerName} · ${row.propertyName}`}
        onClose={() => setDeclining(false)}
        onSubmit={(reason) => decideContinuation(row.id, "REJECT", reason)}
        onDeclined={() => {
          setDeclining(false);
          setDone("Declined");
          onDecided();
        }}
      />
    </li>
  );
}

function requestedLine(job: LiveJobRow, timeZone: string): string | null {
  if (!job.delayNotice) return null;
  const at = new Date(job.delayNotice.at);
  const clock = Number.isNaN(at.getTime()) ? job.delayNotice.at : formatInTimeZone(at, timeZone, "HH:mm");
  return `Client delay notice requested at ${clock} by ${job.delayNotice.byName}.`;
}

export function LiveExceptions({ jobs, continuations, readOnly, canNotifyClient = false, canPauseClock = false, todayKey = "", timeZone = "Australia/Sydney", onReassign, onSelect, onDecided }: ExceptionProps) {
  const [noticeJob, setNoticeJob] = useState<LiveJobRow | null>(null);
  const [pauseJob, setPauseJob] = useState<LiveJobRow | null>(null);
  const phone = useIsPhone();
  const [sheet, setSheet] = useState<{ title: string; items: ERowMenuItem[] } | null>(null);
  const more = (title: string, items: ERowMenuItem[]) =>
    items.length > 0 ? (
      <EButton size="sm" variant="outline" aria-label={`More actions for ${title}`} onClick={() => setSheet({ title, items })}>More</EButton>
    ) : null;
  const notify = canNotifyClient && !readOnly;
  const pause = canPauseClock && !readOnly;
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
          {requestedLine(job, timeZone) ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{requestedLine(job, timeZone)}</p> : null}
          <div className="flex flex-wrap gap-2">
            <CallButton job={job} />
            {phone ? null : <EButton asChild size="sm" variant="outline"><Link href={jobTabHref(job.jobId, "messages")}>Message</Link></EButton>}
            {notify ? (
              <EButton size="sm" variant="outline" onClick={() => setNoticeJob(job)}>{job.delayNotice ? "Tell client again…" : "Tell client"}</EButton>
            ) : (
              <EButton asChild size="sm" variant="outline"><Link href={jobTabHref(job.jobId, "messages")} title="Opens the job's client messages">Tell client</Link></EButton>
            )}
            {readOnly || phone ? null : <EButton size="sm" onClick={() => onReassign(job.jobId)}>Reassign</EButton>}
            {phone ? more(`${who(job)} · ${job.propertyName}`, [
              { key: "message", label: "Message", href: jobTabHref(job.jobId, "messages") },
              ...(readOnly ? [] : [{ key: "reassign", label: "Reassign", onSelect: () => onReassign(job.jobId) }]),
            ]) : null}
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
            {pause && (job.runningClocks?.length ?? 0) > 0 ? <EButton size="sm" onClick={() => setPauseJob(job)}>Pause clock</EButton> : null}
            {phone && pause && (job.runningClocks?.length ?? 0) > 0
              ? more(`${who(job)} · ${job.propertyName}`, [{ key: "review", label: "Review clock", href: jobTabHref(job.jobId, "activity") }])
              : <EButton asChild size="sm" variant="outline"><Link href={jobTabHref(job.jobId, "activity")}>Review clock</Link></EButton>}
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
      <DelayNoticeDialog job={noticeJob} todayKey={todayKey} timeZone={timeZone} onClose={() => setNoticeJob(null)} onRequested={onDecided} />
      <PauseClockDialog job={pauseJob} timeZone={timeZone} onClose={() => setPauseJob(null)} onPaused={onDecided} />
      {phone ? (
        <PhoneActionSheet open={sheet !== null} onOpenChange={(open) => { if (!open) setSheet(null); }} title={sheet?.title ?? "More actions"} items={sheet?.items ?? []} />
      ) : null}
    </ul>
  );
}
