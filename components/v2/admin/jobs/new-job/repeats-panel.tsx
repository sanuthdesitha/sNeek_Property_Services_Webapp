"use client";

/**
 * Repeats: saves a recurring rule through the existing recurring-rule API,
 * the same store the nightly generator reads. The rule id is fixed per draft,
 * so pressing Save twice updates one rule instead of adding two.
 */
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, EField } from "@/components/v2/admin/estate-kit";
import { dayLabel, jobTypeLabel, type NewJobDraft } from "@/lib/jobs/new-job/draft";
import type { NewJobOptions } from "@/lib/jobs/new-job/types";
import { RecurringRulesList, ruleDaysText } from "../recurring-rules-list";
import { ChoiceChip, Faint, NewMark } from "./new-job-ui";

const DAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" },
  { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" },
];

export type RepeatsPanelProps = {
  draft: NewJobDraft;
  update: (patch: Partial<NewJobDraft>) => void;
  propertyName: string | null;
  recurring: NewJobOptions["recurring"] | null;
  cleanerText: string;
  todayKey: string;
  save: RepeatsSave;
  onSave: () => void;
  refreshKey: number;
  canRepeat: boolean;
};

export type RepeatsSave = { status: "idle" | "saving" | "saved" | "failed"; message: string | null };

export function repeatsBody(draft: NewJobDraft, propertyName: string | null) {
  const assigneeIds = draft.cleaner.kind === "chosen" ? draft.cleaner.ids : [];
  return {
    id: draft.repeats.ruleId,
    name: `${propertyName ?? "Property"} · ${jobTypeLabel(draft.jobType)} · ${ruleDaysText(draft.repeats.daysOfWeek)}`,
    isActive: true,
    propertyId: draft.propertyId,
    jobType: draft.jobType,
    daysOfWeek: draft.repeats.daysOfWeek,
    startDate: draft.repeats.startDate || undefined,
    endDate: draft.repeats.endDate || undefined,
    startTime: draft.startTime || undefined,
    dueTime: draft.dueTime || undefined,
    estimatedHours: Number(draft.estimatedHours) > 0 ? Number(draft.estimatedHours) : undefined,
    notes: draft.notes.trim() || undefined,
    assigneeIds,
  };
}

export function RepeatsPanel({ draft, update, recurring, cleanerText, todayKey, save, onSave, refreshKey, canRepeat }: RepeatsPanelProps) {
  const days = draft.repeats.daysOfWeek;

  function toggleDay(value: number) {
    const next = days.includes(value) ? days.filter((day) => day !== value) : [...days, value];
    update({ repeats: { ...draft.repeats, daysOfWeek: next } });
  }

  const summary = [
    draft.repeats.startDate ? `From ${dayLabel(draft.repeats.startDate)}` : "From now",
    draft.repeats.endDate ? `until ${dayLabel(draft.repeats.endDate)}` : "no end date",
    draft.startTime || "no start time",
    Number(draft.estimatedHours) > 0 ? `${Number(draft.estimatedHours).toFixed(2)} h` : "hours not set",
    cleanerText,
  ].join(" · ");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Faint>Saves a recurring rule, the same one the nightly job reads</Faint> <NewMark />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Repeats on">
        {DAYS.map((day) => <ChoiceChip key={day.value} selected={days.includes(day.value)} onClick={() => toggleDay(day.value)}>{day.label}</ChoiceChip>)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <EField label="From"><EInput type="date" min={todayKey} value={draft.repeats.startDate} onChange={(event) => update({ repeats: { ...draft.repeats, startDate: event.target.value } })} /></EField>
        <EField label="Until, optional"><EInput type="date" min={draft.repeats.startDate || todayKey} value={draft.repeats.endDate} onChange={(event) => update({ repeats: { ...draft.repeats, endDate: event.target.value } })} /></EField>
      </div>
      <p className="text-[0.8125rem]">{summary}</p>
      <Faint>
        {recurring
          ? recurring.enabled
            ? `Recurring generation is On: jobs appear ${recurring.lookaheadDays} days ahead each night at 03:05, and a day that already has the same type and start is skipped. The preferred cleaner is offered as on every new job.`
            : "Recurring generation is Off in Settings → Scheduling rules, so a saved rule creates nothing until it is switched on."
          : "Reading the recurring generation setting…"}
      </Faint>
      {!canRepeat ? <p className="text-[0.8125rem] text-[hsl(var(--e-band-attention-fg))]">Repeating rules belong to Calendar, and your access to it does not allow saving.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <EButton type="button" onClick={onSave} disabled={save.status === "saving" || !canRepeat}>{save.status === "saving" ? "Saving rule…" : "Save repeating rule"}</EButton>
        {save.message ? (
          <p role={save.status === "failed" ? "alert" : "status"} className={save.status === "failed" ? "text-[0.8125rem] text-[hsl(var(--e-danger))]" : "text-[0.8125rem] text-[hsl(var(--e-band-good-fg))]"}>{save.message}</p>
        ) : null}
      </div>
      {draft.propertyId ? (
        <div className="space-y-1">
          <p className="text-[0.75rem] font-[600] uppercase tracking-wide text-[hsl(var(--e-text-secondary))]">Rules for this property</p>
          <RecurringRulesList propertyId={draft.propertyId} refreshKey={refreshKey} />
        </div>
      ) : null}
    </div>
  );
}
