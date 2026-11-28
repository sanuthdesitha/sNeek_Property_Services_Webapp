"use client";

/**
 * Approvals side panel for "Looks unused — ask the office" (2026-11-28): a
 * cleaner at an Airbnb turnover that looks like nobody stayed is waiting for
 * an answer before cleaning. The office answers Clean as normal, Light
 * refresh only or Do not clean, with an optional note
 * (PATCH /api/admin/job-unused-checks/[id]).
 *
 * The answer is a record and a message to the cleaners on the job. It never
 * cancels, skips or re-prices the job or changes pay: the office updates the
 * job itself, through the job page.
 */
import * as React from "react";
import { Send } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EvidenceThumbs } from "@/components/v2/shared/evidence-thumbs";
import {
  UNUSED_CHECK_DECISIONS,
  UNUSED_CHECK_DECISION_LABELS,
  UNUSED_CHECK_NOTE_MAX,
  type UnusedCheckDecision,
} from "@/lib/jobs/unused-check-rules";
import { ContextLinks, DetailList, PanelNote, PanelSection, formatDay, formatInstant, jobHref, type QueuePanelProps } from "./panel-kit";

/** What each answer means, as the office reads it before sending. */
const DECISION_HINTS: Record<UnusedCheckDecision, string> = {
  CLEAN_AS_NORMAL: "The cleaner does the full turnover.",
  LIGHT_REFRESH: "The cleaner does a light refresh only. Say what in the note.",
  DO_NOT_CLEAN: "The cleaner stops. The job is not cancelled, skipped or re-priced: update it yourself on the job page.",
};

const NOTE_FIELD =
  "w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 py-2 text-[16px] sm:text-[0.8125rem] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

export function UnusedCheckPanel({ row, busy, decide, timezone }: QueuePanelProps) {
  const record = row.record;
  const [decision, setDecision] = React.useState<UnusedCheckDecision | null>(null);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const ids = React.useId();
  const job = record.job;
  const attachments = record.attachmentUrls ?? [];

  async function send() {
    if (!decision) {
      setError("Choose an answer first.");
      return;
    }
    setError(null);
    // A refused answer keeps the panel open with the choice and note (the
    // workspace says why); the same answer again is a replay on the server.
    await decide({
      url: `/api/admin/job-unused-checks/${encodeURIComponent(record.id)}`,
      method: "PATCH",
      body: { decision, note: note.trim() || null },
      successMsg: `Answer sent: ${UNUSED_CHECK_DECISION_LABELS[decision]}`,
    });
  }

  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Cleaner", record.cleaner?.name ?? record.cleaner?.email ?? "—"],
            ["Job", [job?.jobNumber ? String(job.jobNumber) : null, formatDay(job?.scheduledDate), job?.startTime ?? null].filter(Boolean).join(" · ") || "—"],
            ["Asked", formatInstant(record.createdAt, timezone)],
            ["Note", record.note ? `“${record.note}”` : "No note"],
          ]}
        />
        {attachments.length > 0 ? <EvidenceThumbs items={attachments} alt="Looks unused photos" docLabel="Open photo" /> : null}
        <PanelNote>The cleaner is waiting at the property and has been told not to clean until you answer.</PanelNote>
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "View job" } : null]} />
      </PanelSection>
      <PanelSection title="Answer" tone="decision">
        <fieldset disabled={busy} className="flex flex-col gap-3">
          <legend className="sr-only">Answer for the cleaner</legend>
          <div role="radiogroup" aria-label="Answer for the cleaner" className="flex flex-col gap-2">
            {UNUSED_CHECK_DECISIONS.map((option) => (
              <label
                key={option}
                className={
                  "flex min-h-11 cursor-pointer items-start gap-2 rounded-[var(--e-radius-sm)] border px-3 py-2 text-[0.8125rem] " +
                  (decision === option ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.06)]" : "border-[hsl(var(--e-border))]")
                }
              >
                <input
                  type="radio"
                  name={`${ids}-decision`}
                  value={option}
                  checked={decision === option}
                  onChange={() => setDecision(option)}
                  className="mt-0.5 accent-[hsl(var(--e-primary))]"
                />
                <span className="min-w-0">
                  <span className="block font-[600]">{UNUSED_CHECK_DECISION_LABELS[option]}</span>
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{DECISION_HINTS[option]}</span>
                </span>
              </label>
            ))}
          </div>
          <label htmlFor={`${ids}-note`} className="text-[0.75rem] font-[550]">Note to the cleaner (optional)</label>
          <textarea
            id={`${ids}-note`}
            className={NOTE_FIELD}
            rows={3}
            maxLength={UNUSED_CHECK_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          <div>
            <EButton size="sm" variant="gold" onClick={() => void send()}>
              <Send aria-hidden className="h-3.5 w-3.5" /> Send answer
            </EButton>
          </div>
          <PanelNote>The cleaners on the job get your answer in their inbox and on the job screen. Never by email or SMS.</PanelNote>
        </fieldset>
      </PanelSection>
    </>
  );
}
