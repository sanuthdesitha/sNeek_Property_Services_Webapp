"use client";

/**
 * Laundry partner "Pickup and drop schedule" (board "Suppliers", partner side
 * panel; owner decision 2026-11-13). Shows the stated days and windows
 * ("Pickups Mon to Sat, 13:00 to 16:00", "Sunday No service") and, on the
 * Schedule tab, edits them through PATCH /api/admin/laundry/suppliers/[id]/schedule.
 * Descriptive defaults only: they prefill the planned TIME of new runs for
 * this partner and are shown when planning; no run, date or planning rule
 * changes. The draft is kept while saving fails and reset for another partner.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import {
  WEEKDAY_ORDER,
  WEEKDAY_SHORT,
  describeLeg,
  noServiceDays,
  normalizeWeekdays,
  scheduleStated,
  EMPTY_PARTNER_SCHEDULE,
  type PartnerSchedule,
  type ScheduleLeg,
} from "@/lib/laundry/partner-schedule";

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

type ScheduleDraft = {
  pickupWeekdays: number[];
  pickupWindowStart: string;
  pickupWindowEnd: string;
  dropWeekdays: number[];
  dropWindowStart: string;
  dropWindowEnd: string;
};

type SaveState = { status: "idle" } | { status: "saving" } | { status: "failed"; message: string } | { status: "saved" };

function toDraft(schedule: PartnerSchedule | undefined): ScheduleDraft {
  const value = schedule ?? EMPTY_PARTNER_SCHEDULE;
  return {
    pickupWeekdays: [...value.pickupWeekdays],
    pickupWindowStart: value.pickupWindowStart ?? "",
    pickupWindowEnd: value.pickupWindowEnd ?? "",
    dropWeekdays: [...value.dropWeekdays],
    dropWindowStart: value.dropWindowStart ?? "",
    dropWindowEnd: value.dropWindowEnd ?? "",
  };
}

export function PartnerScheduleSummary({ schedule }: { schedule: PartnerSchedule | undefined }) {
  if (!schedule || !scheduleStated(schedule)) {
    return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No pickup and drop schedule is recorded for this partner. Nothing is prefilled on new runs.</p>;
  }
  const closed = noServiceDays(schedule);
  const rows: Array<[string, string]> = [
    ["Pickups", describeLeg(schedule, "pickup") ?? "Not stated"],
    ["Drops", describeLeg(schedule, "drop") ?? "Not stated"],
    ...closed.map((day): [string, string] => [WEEKDAY_LONG[day], "No service"]),
  ];
  return (
    <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.8125rem]">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function LegEditor({ leg, draft, onChange }: { leg: ScheduleLeg; draft: ScheduleDraft; onChange: (next: ScheduleDraft) => void }) {
  const daysKey = leg === "pickup" ? "pickupWeekdays" : "dropWeekdays";
  const startKey = leg === "pickup" ? "pickupWindowStart" : "dropWindowStart";
  const endKey = leg === "pickup" ? "pickupWindowEnd" : "dropWindowEnd";
  const ids = { start: React.useId(), end: React.useId() };
  const title = leg === "pickup" ? "Pickups" : "Drops";
  function toggle(day: number) {
    const current = draft[daysKey];
    const next = current.includes(day) ? current.filter((value) => value !== day) : [...current, day];
    onChange({ ...draft, [daysKey]: normalizeWeekdays(next) });
  }
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-[0.8125rem] font-[600]">{title}</legend>
      <div role="group" aria-label={`${title} days`} className="flex flex-wrap gap-1">
        {WEEKDAY_ORDER.map((day) => (
          <button key={day} type="button" aria-pressed={draft[daysKey].includes(day)} onClick={() => toggle(day)} className={`min-h-9 min-w-11 rounded-full border px-2 text-[0.75rem] ${draft[daysKey].includes(day) ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.1)] font-[600]" : "border-[hsl(var(--e-border-strong))]"}`}>
            {WEEKDAY_SHORT[day]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={ids.start} className="text-[0.75rem]">From
          <input id={ids.start} type="time" value={draft[startKey]} onChange={(event) => onChange({ ...draft, [startKey]: event.target.value })} className="mt-0.5 h-9 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[16px] sm:text-[0.8125rem]" />
        </label>
        <label htmlFor={ids.end} className="text-[0.75rem]">To
          <input id={ids.end} type="time" value={draft[endKey]} onChange={(event) => onChange({ ...draft, [endKey]: event.target.value })} className="mt-0.5 h-9 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[16px] sm:text-[0.8125rem]" />
        </label>
      </div>
    </fieldset>
  );
}

export function PartnerScheduleEditor({ partnerId, schedule, updatedAt, onSaved }: { partnerId: string; schedule: PartnerSchedule | undefined; updatedAt: string | undefined; onSaved: () => void }) {
  const [draft, setDraft] = React.useState<ScheduleDraft>(() => toDraft(schedule));
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  const saving = save.status === "saving";

  async function submit() {
    setSave({ status: "saving" });
    try {
      const response = await fetch(`/api/admin/laundry/suppliers/${encodeURIComponent(partnerId)}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupWeekdays: draft.pickupWeekdays,
          pickupWindowStart: draft.pickupWindowStart || null,
          pickupWindowEnd: draft.pickupWindowEnd || null,
          dropWeekdays: draft.dropWeekdays,
          dropWindowStart: draft.dropWindowStart || null,
          dropWindowEnd: draft.dropWindowEnd || null,
          ...(updatedAt ? { expectedUpdatedAt: updatedAt } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) return setSave({ status: "failed", message: body?.error ?? `Not saved (${response.status}).` });
      setSave({ status: "saved" });
      onSaved();
    } catch {
      setSave({ status: "failed", message: "No answer from the server. The schedule may not be saved; refresh before trying again." });
    }
  }

  return (
    <div className="space-y-3">
      <fieldset disabled={saving} className="space-y-3">
        <LegEditor leg="pickup" draft={draft} onChange={setDraft} />
        <LegEditor leg="drop" draft={draft} onChange={setDraft} />
      </fieldset>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Usual days and times only. New runs for this partner get the window start as their planned time when none is set, on the days stated. Dates, turnaround rules and existing runs do not change.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <EButton size="sm" disabled={saving} onClick={() => void submit()}>{saving ? "Saving…" : save.status === "failed" ? "Try again" : "Save schedule"}</EButton>
        <EButton size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft({ ...toDraft(undefined) }); setSave({ status: "idle" }); }}>Clear all</EButton>
      </div>
      {save.status === "failed" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{save.message}</p> : null}
      {save.status === "saved" ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-success))]">Schedule saved.</p> : null}
    </div>
  );
}
