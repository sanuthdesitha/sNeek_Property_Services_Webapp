/**
 * Guest timing on the admin job page (server component): the late checkout /
 * early check-in / same-day check-in tags in the shared wording, and whether
 * each cleaner acknowledged the timing rules when they started, read from the
 * stored start-briefing record (lib/jobs/job-page/timing-ack.ts).
 *
 * Renders nothing when the job has no guest timing at all.
 */
import { TimingTags } from "@/components/v2/ui/timing-tags";
import { timingAckSentence, type TimingAckRow, type TimingAckSummary } from "@/lib/jobs/job-page/timing-ack";
import type { TimingTag } from "@/lib/jobs/timing-tags";

function AckLine({ row }: { row: TimingAckRow }) {
  const ok = row.state.kind === "acknowledged";
  return (
    <li className={ok ? "" : "font-[550]"}>
      <span aria-hidden className={ok ? "text-[hsl(var(--e-success))]" : "text-[hsl(var(--e-warning))]"}>{ok ? "✓ " : "! "}</span>
      {timingAckSentence(row)}
    </li>
  );
}

function AckStatus({ ack }: { ack: TimingAckSummary }) {
  if (ack.kind === "none") return null;
  if (ack.kind === "error") {
    return <p className="text-[hsl(var(--e-danger))]">Timing acknowledgement could not be read. Reload the page; do not treat it as acknowledged.</p>;
  }
  if (ack.rows.length === 0) {
    return <p>Not acknowledged yet: no cleaner is on this job.</p>;
  }
  return <ul className="space-y-0.5">{ack.rows.map((row) => <AckLine key={row.userId} row={row} />)}</ul>;
}

export function JobGuestTiming({ tags, ack }: { tags: TimingTag[]; ack: TimingAckSummary }) {
  if (tags.length === 0 && ack.kind === "none") return null;
  return (
    <section aria-labelledby="job-guest-timing" className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3 text-[0.8125rem]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="job-guest-timing" className="font-[600]">Guest timing</h2>
        <TimingTags tags={tags} />
      </div>
      {ack.kind !== "none" ? (
        <div className="space-y-1 text-[hsl(var(--e-text-secondary))]">
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Cleaners confirm the timing rules before their clock starts. A change to the time needs a new confirmation.</p>
          <AckStatus ack={ack} />
        </div>
      ) : null}
    </section>
  );
}
