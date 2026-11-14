"use client";

/**
 * "This is what Create job saves": the summary rail (desktop) and the Review
 * step (phone) read the same rows. The saved panel repeats exactly what the
 * server reported — created, offered, accepted by the email provider — and
 * never says accepted by the cleaner or delivered.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneCard, ETonePill } from "@/components/v2/ui/tone-band";
import {
  dayLabel,
  draftPriority,
  formatMoney,
  jobTypeLabel,
  targetDays,
  type DraftProblem,
  type NewJobDraft,
} from "@/lib/jobs/new-job/draft";
import type { NewJobDayCheck, NewJobPropertyFacts } from "@/lib/jobs/new-job/types";
import type { BookingEmailOutcome, PreferredCleanerOutcome } from "@/lib/jobs/admin-create";
import { clientPriceText } from "./what-section";
import { laundrySummary } from "./extras-sections";
import type { CreateRun, DayOutcome } from "./use-create-job";

export type SummaryRow = { label: string; value: string; sub?: string; tone?: "attention" | "problem" };

export function cleanerSummary(draft: NewJobDraft, facts: NewJobPropertyFacts | null): { value: string; sub?: string } {
  const rate = facts?.cleanerPay.rate ?? null;
  if (draft.cleaner.kind === "unassigned") return { value: "Unassigned", sub: "preferred cleaner skipped" };
  if (draft.cleaner.kind === "chosen") return { value: draft.cleaner.names.join(", "), sub: "chosen, offered on create" };
  const preferred = facts?.preferredCleaner;
  if (preferred?.active) return { value: `${preferred.name} offered`, sub: rate !== null ? `${formatMoney(rate)} an hour` : "rate not set" };
  return { value: "Nobody offered", sub: "no active preferred cleaner" };
}

export function warningsFor(draft: NewJobDraft, facts: NewJobPropertyFacts | null, check: NewJobDayCheck | null): string[] {
  const warnings: string[] = [];
  const days = check?.days ?? [];
  for (const day of days) {
    if (day.sameDayJobs.length) warnings.push(`${dayLabel(day.dayKey)}: ${day.sameDayJobs.map((job) => job.jobNumber).join(", ")} already there`);
  }
  if (facts && !facts.property.isActive) warnings.push("Property is inactive");
  if (facts && !draft.fixedPriceOn && facts.clientPrice.missing) warnings.push("Client price not set");
  if (facts && !draft.estimatedHours) warnings.push("Pay hours not set (pays clocked time)");
  if (facts && !facts.form) warnings.push("No cleaner form for this type");
  if (check?.bookingEmail?.blockedReason && draft.sendBookingConfirmation) warnings.push("Booking email would not be sent");
  return warnings;
}

export function summaryRows(draft: NewJobDraft, facts: NewJobPropertyFacts | null, check: NewJobDayCheck | null, propertyName: string | null): SummaryRow[] {
  const days = targetDays(draft);
  const first = check?.days[0] ?? null;
  const when =
    draft.mode === "repeats"
      ? { value: draft.repeats.daysOfWeek.length ? "Repeats weekly" : "Repeat days not chosen", sub: draft.startTime || undefined }
      : days.length === 0
        ? { value: "Date not chosen" }
        : days.length === 1
          ? { value: `${dayLabel(days[0].dayKey)} · ${draft.startTime || "no start"}`, sub: draft.dueTime ? `ready by ${draft.dueTime}` : undefined }
          : { value: `${days.length} dates`, sub: `${dayLabel(days[0].dayKey)} to ${dayLabel(days[days.length - 1].dayKey)}` };
  const hours = Number(draft.estimatedHours) > 0 ? `${Number(draft.estimatedHours).toFixed(2)} h` : "Not set (pays clocked time)";
  const cleaner = cleanerSummary(draft, facts);
  const special = draft.specialTasks.length;
  const carried = first?.carryForwardAttaches === "yes" ? facts?.carryForward.count ?? 0 : 0;
  const warnings = warningsFor(draft, facts, check);
  const guestIn = first?.guestIn?.time ? `guest in ${first.guestIn.time} noted` : null;
  const site = draft.siteMode === "one_off" && draft.jobType !== "AIRBNB_TURNOVER" ? draft.oneOff.siteName || "One-off address" : propertyName;
  const email = check?.bookingEmail ?? null;
  return [
    { label: "Property", value: site ?? "Not chosen", sub: facts?.client?.name ?? undefined },
    { label: "Job", value: `${jobTypeLabel(draft.jobType)} · priority ${draftPriority(draft)}` },
    { label: "When", ...when },
    { label: "Pay hours", value: hours },
    { label: "Cleaner", ...cleaner },
    { label: "Client price", value: clientPriceText(draft, facts), sub: draft.fixedPriceOn ? undefined : facts && !facts.clientPrice.missing ? "rate at invoicing" : undefined, tone: facts && facts.clientPrice.missing && !draft.fixedPriceOn ? "attention" : undefined },
    { label: "Tasks", value: special || carried ? `${special} special${carried ? ` + ${carried} carried forward` : ""}` : "None" },
    { label: "Laundry", value: draft.mode === "one" ? laundrySummary(first?.laundry ?? null) : draft.mode === "several" ? "Preview per date" : "Planned per job later" },
    { label: "Client", value: !draft.sendBookingConfirmation ? "No booking email (switched off)" : email?.blockedReason ? "Booking email would not be sent" : email ? "Booking confirmation email" : "—" },
    { label: "Warnings", value: warnings.length ? warnings.join(" · ") : `None${guestIn ? ` · ${guestIn}` : ""}`, tone: warnings.length ? "attention" : undefined },
  ];
}

export function SummaryList({ rows, className }: { rows: SummaryRow[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]", className)}>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-2">
          <dt className="text-[hsl(var(--e-text-secondary))]">{row.label}</dt>
          <dd className={cn("min-w-0 break-words", row.tone === "attention" && "text-[hsl(var(--e-band-attention-fg))]")}>
            <span className="font-[600]">{row.value}</span>
            {row.sub ? <span className="text-[hsl(var(--e-text-secondary))]"> {row.sub}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProblemList({ problems, onGo }: { problems: DraftProblem[]; onGo: (problem: DraftProblem) => void }) {
  if (problems.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-band-problem-line))] bg-[hsl(var(--e-band-problem-bg))] p-2 text-[0.8125rem] text-[hsl(var(--e-band-problem-fg))]">
      {problems.map((problem) => (
        <li key={problem.field + problem.message} className="flex items-center justify-between gap-2">
          <span><span aria-hidden className="mr-1 font-[700]">!</span>{problem.message}</span>
          <button type="button" className="shrink-0 underline" onClick={() => onGo(problem)}>Go to {problem.section === "what" ? "What" : problem.section === "who" ? "Who" : problem.section === "property" ? "Property" : problem.section === "extras" ? "Extras" : "When"}</button>
        </li>
      ))}
    </ul>
  );
}

function preferredText(outcome: PreferredCleanerOutcome | undefined, preferredName: string | null): string {
  if (!outcome) return "";
  if (outcome.outcome === "offered") return `${preferredName ?? "The preferred cleaner"} offered, not yet accepted.`;
  if (outcome.outcome === "skipped_by_office") return "Left unassigned; the preferred cleaner was not offered.";
  return "Nobody was offered the job.";
}

const EMAIL_REASONS: Record<string, string> = {
  "client-opted-out": "the client has turned notifications off",
  "no-recipients": "the client has no email on file",
  "no-client": "there is no client",
  error: "it could not be sent",
  "not-accepted": "the email provider did not accept it (automatic emails may be off or the provider not configured)",
};

function emailText(outcome: BookingEmailOutcome | undefined): string {
  if (!outcome) return "";
  if (outcome.outcome === "accepted") return `Booking confirmation accepted by the email provider for ${outcome.recipients.length} recipient${outcome.recipients.length === 1 ? "" : "s"}, not delivered yet.`;
  if (outcome.outcome === "switched_off") return "Booking confirmation not sent: switched off for this job.";
  if (outcome.outcome === "not_applicable") return "No booking email: this job has no client.";
  return `Booking confirmation not sent: ${EMAIL_REASONS[outcome.reason] ?? outcome.reason}.`;
}

export function outcomeSentence(outcome: DayOutcome, context: { propertyName: string | null; startTime: string; preferredName: string | null; chosenNames: string[] }): string {
  const head = `${outcome.jobNumber ?? "Job"} ${outcome.state === "replayed" ? "was already created by an earlier attempt" : "created"} · ${context.propertyName ?? "property"} · ${dayLabel(outcome.dayKey)}${context.startTime ? ` ${context.startTime}` : ""}.`;
  const parts = [head];
  if (outcome.assign === "done") parts.push(`${context.chosenNames.join(", ")} offered, not yet accepted.`);
  else if (outcome.followUps) parts.push(preferredText(outcome.followUps.preferredCleaner, context.preferredName));
  if (outcome.assign === "failed") parts.push(outcome.assignMessage ?? "The cleaner was not assigned.");
  if (outcome.followUps) parts.push(emailText(outcome.followUps.bookingEmail));
  if (outcome.changedSinceFirstAttempt) parts.push("Changes made after the first attempt were not applied; edit them on the job page.");
  return parts.filter(Boolean).join(" ");
}

export function SavedPanel({
  run,
  draft,
  propertyName,
  preferredName,
  onAnother,
  onRetry,
  canRetry,
}: {
  run: CreateRun;
  draft: NewJobDraft;
  propertyName: string | null;
  preferredName: string | null;
  onAnother: () => void;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const created = run.outcomes.filter((outcome) => outcome.jobId);
  const failed = run.outcomes.filter((outcome) => outcome.state === "failed" || outcome.assign === "failed");
  const skipped = run.outcomes.filter((outcome) => outcome.state === "skipped");
  const tone = run.status === "done" ? "good" : run.status === "partial" ? "attention" : "problem";
  const chosenNames = draft.cleaner.kind === "chosen" ? draft.cleaner.names : [];
  const pill = run.status === "done" ? "Created" : run.status === "partial" ? "Partly created" : "Not created";
  return (
    <EToneCard
      tone={tone}
      tabIndex={-1}
      id="new-job-result"
      header={<p className="text-[0.9375rem] font-[600]">{run.status === "done" ? (created.length === 1 ? "Saved" : `${created.length} jobs saved`) : run.status === "partial" ? "Some jobs were not saved" : "The job was not saved"}</p>}
      pill={pill}
    >
      <div className="space-y-2 text-[0.8125rem]" role={run.status === "done" ? "status" : "alert"}>
        {run.outcomes.map((outcome) => (
          <p key={outcome.dayKey}>
            {outcome.jobId
              ? outcomeSentence(outcome, { propertyName, startTime: draft.mode === "several" ? draft.severalDays.find((day) => day.dayKey === outcome.dayKey)?.startTime ?? draft.startTime : draft.startTime, preferredName, chosenNames })
              : `${dayLabel(outcome.dayKey)}: ${outcome.message ?? "not created."}`}
          </p>
        ))}
        {skipped.length ? <p className="text-[hsl(var(--e-text-secondary))]">{skipped.length} date{skipped.length === 1 ? "" : "s"} skipped because a job is already there.</p> : null}
        {failed.length ? <p>Your entries and the request key are kept. Retry creates only what is missing and never a second copy.</p> : null}
        <div className="flex flex-wrap gap-2 pt-1">
          {created.length === 1 && run.status === "done" ? (
            <EButton asChild><Link href={`/v2/admin/jobs/${encodeURIComponent(created[0].jobId!)}`}>Open {created[0].jobNumber ?? "job"}</Link></EButton>
          ) : created.length > 1 ? (
            <EButton asChild variant={run.status === "done" ? "primary" : "outline"}><Link href="/v2/admin/jobs">Open the jobs list</Link></EButton>
          ) : null}
          {failed.length && canRetry ? <EButton type="button" onClick={onRetry}>Retry</EButton> : null}
          {run.status === "done" ? <EButton type="button" variant="outline" onClick={onAnother}>Another for this property</EButton> : null}
        </div>
        {run.status === "done" ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Another for this property keeps the property, type and times and clears the date.</p> : null}
      </div>
    </EToneCard>
  );
}

export function StatusPill({ count }: { count: number }) {
  return count === 0 ? <ETonePill tone="good">Ready</ETonePill> : <ETonePill tone="attention">{count} to fix</ETonePill>;
}
