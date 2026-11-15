"use client";

/**
 * Section 3 / phone step "When": one date (a date picker, not typed text),
 * several dates, or a repeating rule; the times; early check-in and late
 * checkout; and what the booking calendar says about the day, including a
 * job already there. A clash or a missing booking is shown, never hidden.
 */
import { tourTarget } from "@/lib/tutorials/targets";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EInput, ESelect, EField } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import { EToneNotice, ETonePill } from "@/components/v2/ui/tone-band";
import {
  addDays,
  applyTimingChoice,
  dayLabel,
  draftPriority,
  jobTypeLabel,
  type NewJobDraft,
  type TimingChoice,
} from "@/lib/jobs/new-job/draft";
import type { NewJobDay, NewJobDayCheck, NewJobPropertyFacts } from "@/lib/jobs/new-job/types";
import type { ReadState } from "./use-new-job-data";
import { Faint, Segmented } from "./new-job-ui";

export type WhenSectionProps = {
  draft: NewJobDraft;
  setDraft: (next: (draft: NewJobDraft) => NewJobDraft) => void;
  update: (patch: Partial<NewJobDraft>) => void;
  facts: ReadState<NewJobPropertyFacts>;
  day: ReadState<NewJobDayCheck>;
  timezone: string;
  todayKey: string;
  problemFields: ReadonlySet<string>;
  compact?: boolean;
  severalSlot: React.ReactNode;
  repeatsSlot: React.ReactNode;
};

const EARLY_OPTIONS: Array<{ value: TimingChoice["preset"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "11:00", label: "Ready before 11:00" },
  { value: "12:30", label: "Ready before 12:30" },
  { value: "custom", label: "Custom" },
];
const LATE_OPTIONS: Array<{ value: TimingChoice["preset"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "12:30", label: "Start after 12:30" },
  { value: "custom", label: "Custom" },
];

function weekStart(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  return addDays(dayKey, -weekday);
}

/** Phone: the week strip of the board, with the native picker beside it. */
function WeekStrip({ value, todayKey, onPick }: { value: string; todayKey: string; onPick: (dayKey: string) => void }) {
  const start = weekStart(value || todayKey);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <button type="button" className="min-h-[44px] px-2 text-[0.8125rem] underline" onClick={() => onPick(addDays(value || todayKey, -7))} aria-label="Previous week">‹ Week</button>
        <button type="button" className="min-h-[44px] px-2 text-[0.8125rem] underline" onClick={() => onPick(addDays(value || todayKey, 7))} aria-label="Next week">Week ›</button>
      </div>
      <div className="grid grid-cols-7 gap-1" role="group" aria-label="Pick a day">
        {days.map((dayKey) => {
          const on = dayKey === value;
          const date = new Date(`${dayKey}T00:00:00.000Z`);
          return (
            <button
              key={dayKey}
              type="button"
              aria-pressed={on}
              aria-label={dayLabel(dayKey, true)}
              onClick={() => onPick(dayKey)}
              className={cn(
                "flex min-h-[48px] flex-col items-center justify-center rounded-[var(--e-radius-sm)] border text-[0.75rem]",
                on ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
              )}
            >
              <span>{date.toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short" })}</span>
              <span className="text-[0.6875rem] opacity-80">{date.getUTCDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function syncedLabel(iso: string | null, timezone: string, todayKey: string): string {
  if (!iso) return "never synced";
  const date = new Date(iso);
  const key = formatInTimeZone(date, timezone, "yyyy-MM-dd");
  return key === todayKey ? `synced today ${formatInTimeZone(date, timezone, "HH:mm")}` : `synced ${formatInTimeZone(date, timezone, "d MMM HH:mm")}`;
}

export function CalendarBand({ day, facts, timezone, todayKey, draft, compact }: { day: NewJobDay; facts: NewJobPropertyFacts | null; timezone: string; todayKey: string; draft: NewJobDraft; compact?: boolean }) {
  const planned = Number(draft.estimatedHours) > 0 ? Number(draft.estimatedHours) : null;
  const fits = planned !== null && day.windowHours !== null ? planned <= day.windowHours : null;
  return (
    <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-band-info-line))]">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[hsl(var(--e-band-info-line))] bg-[hsl(var(--e-band-info-bg))] px-3 py-2">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-[600] text-[hsl(var(--e-band-info-fg))]">{compact ? `${dayLabel(day.dayKey)} calendar` : `From the calendar, ${dayLabel(day.dayKey)}`}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-band-info-muted))]">
            {facts?.ical ? `${facts.ical.provider === "ICAL_HOSPITABLE" ? "Booking" : "Airbnb"} iCal · ${syncedLabel(facts.ical.lastSyncAt, timezone, todayKey)}${facts.ical.enabled ? "" : " · sync is off"}` : "No booking calendar connected for this property"}
          </p>
        </div>
        {day.guestIn?.time ? <ETonePill tone="info">Guest in {day.guestIn.time}</ETonePill> : null}
      </div>
      <div className={cn("grid gap-3 px-3 py-2.5 text-[0.8125rem]", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3")}>
        <div>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Guest out</p>
          {day.guestOut ? (
            <>
              <p className="font-[600]">{day.guestOut.time ?? "time not given"}{day.guestOut.reservationCode ? ` · ${day.guestOut.reservationCode}` : ""}</p>
              <p className="text-[hsl(var(--e-text-secondary))]">{guestsText(day.guestOut.adults, day.guestOut.children)}</p>
            </>
          ) : <p className="text-[hsl(var(--e-text-secondary))]">No booking ends this day</p>}
        </div>
        <div>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Next guest in</p>
          {day.guestIn ? (
            <>
              <p className="font-[600]">{day.guestIn.time ?? "time not given"}{day.guestIn.reservationCode ? ` · ${day.guestIn.reservationCode}` : ""}</p>
              <p className="text-[hsl(var(--e-text-secondary))]">{guestsText(day.guestIn.adults, day.guestIn.children)}{day.guestIn.nights ? `, ${day.guestIn.nights} night${day.guestIn.nights === 1 ? "" : "s"}` : ""}</p>
            </>
          ) : <p className="text-[hsl(var(--e-text-secondary))]">No booking starts this day</p>}
        </div>
        <div>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Window</p>
          {day.windowHours !== null ? (
            <>
              <p className="font-[600]">{day.windowHours} hours</p>
              <p className="text-[hsl(var(--e-text-secondary))]">{planned !== null ? `${planned.toFixed(2)} h planned, ${fits ? "fits" : "does not fit"}` : "pay hours not set"}</p>
            </>
          ) : <p className="text-[hsl(var(--e-text-secondary))]">Not known (needs both times)</p>}
        </div>
      </div>
      <div className="border-t border-[hsl(var(--e-border))] px-3 py-2">
        <SameDayLine day={day} />
      </div>
    </div>
  );
}

function guestsText(adults: number | null, children: number | null): string {
  if (adults === null && children === null) return "guests not given";
  const parts: string[] = [];
  if (adults !== null) parts.push(`${adults} adult${adults === 1 ? "" : "s"}`);
  if (children) parts.push(`${children} child${children === 1 ? "" : "ren"}`);
  return parts.join(", ");
}

export function SameDayLine({ day }: { day: NewJobDay }) {
  if (day.sameDayJobs.length === 0) {
    return <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">No other job at this property that day. A clash or a missing booking is shown here, never hidden.</p>;
  }
  return (
    <EToneNotice tone="problem" className="text-[0.8125rem]">
      {day.sameDayJobs.map((job) => (
        <p key={job.jobId}>
          <strong className="font-[600]">{job.jobNumber} {jobTypeLabel(job.jobType)}</strong> is already on {dayLabel(day.dayKey)}{job.startTime ? ` at ${job.startTime}` : ""}
          {job.fromCalendar ? ", created by the calendar sync" : ""}.{" "}
          {job.cleaners.length ? `${job.cleaners.join(", ")} ${job.accepted ? "accepted it" : "offered, not accepted yet"}.` : "Nobody is on it yet."}{" "}
          <Link href={`/v2/admin/jobs/${encodeURIComponent(job.jobId)}`} className="underline">Open {job.jobNumber}</Link>
        </p>
      ))}
      <p className="mt-1">Creating another job that day asks once to confirm.</p>
    </EToneNotice>
  );
}

export function WhenSection({ draft, setDraft, update, facts, day, timezone, todayKey, problemFields, compact = false, severalSlot, repeatsSlot }: WhenSectionProps) {
  const isAirbnb = draft.jobType === "AIRBNB_TURNOVER";
  const first = day.data?.days[0] ?? null;
  const checkout = facts.data?.property.defaultCheckoutTime ?? null;
  const checkin = facts.data?.property.defaultCheckinTime ?? null;
  const setTiming = (kind: "earlyCheckin" | "lateCheckout", rule: TimingChoice) => setDraft((current) => applyTimingChoice(current, kind, rule));

  const times = (
    <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
      {!compact && draft.mode === "one" ? (
        <EField label="Date">
          <EInput id="new-job-date" type="date" value={draft.dayKey} min={todayKey} aria-invalid={problemFields.has("date") || undefined} onChange={(event) => update({ dayKey: event.target.value })} />
        </EField>
      ) : null}
      <EField label="Start" hint={first?.guestOut?.time === draft.startTime || (!first?.guestOut && draft.startTime === checkout) ? "guest checkout" : undefined}>
        <EInput id="new-job-start" type="time" value={draft.startTime} onChange={(event) => update({ startTime: event.target.value, timesEdited: true })} className="max-sm:text-[16px]" />
      </EField>
      <EField label="Ready by" hint={first?.guestIn?.time === draft.dueTime || (!first?.guestIn && draft.dueTime === checkin) ? "next guest check-in" : undefined}>
        <EInput id="new-job-dueTime" type="time" value={draft.dueTime} aria-invalid={problemFields.has("dueTime") || undefined} onChange={(event) => update({ dueTime: event.target.value, timesEdited: true })} className="max-sm:text-[16px]" />
      </EField>
      {!compact ? (
        <EField label="End, optional">
          <EInput type="time" value={draft.endTime} onChange={(event) => update({ endTime: event.target.value })} />
        </EField>
      ) : null}
    </div>
  );

  const timing = isAirbnb ? (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <EField label="Early check-in">
          <ESelect value={draft.earlyCheckin.preset} onChange={(event) => setTiming("earlyCheckin", { preset: event.target.value as TimingChoice["preset"], time: draft.earlyCheckin.time })}>
            {EARLY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </ESelect>
          {draft.earlyCheckin.preset === "custom" ? (
            <EInput className="mt-2" type="time" aria-label="Early check-in time" value={draft.earlyCheckin.time} onChange={(event) => setTiming("earlyCheckin", { preset: "custom", time: event.target.value })} />
          ) : null}
        </EField>
        <EField label="Late checkout">
          <ESelect value={draft.lateCheckout.preset} onChange={(event) => setTiming("lateCheckout", { preset: event.target.value as TimingChoice["preset"], time: draft.lateCheckout.time })}>
            {LATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </ESelect>
          {draft.lateCheckout.preset === "custom" ? (
            <EInput className="mt-2" type="time" aria-label="Late checkout time" value={draft.lateCheckout.time} onChange={(event) => setTiming("lateCheckout", { preset: "custom", time: event.target.value })} />
          ) : null}
        </EField>
      </div>
      <Faint>A late checkout moves Start; an early check-in moves Ready by. Priority follows the early check-in: this job is priority {draftPriority(draft)}.</Faint>
    </div>
  ) : null;

  return (
    <div {...tourTarget("admin.jobs.create.when")} className="space-y-4">
      <Segmented
        label="How many dates"
        value={draft.mode}
        options={[{ value: "one", label: "One date" }, { value: "several", label: compact ? "Several" : "Several dates" }, { value: "repeats", label: "Repeats" }]}
        onChange={(mode) => update({ mode })}
        className={compact ? "flex w-full" : undefined}
      />
      {draft.mode === "one" ? (
        <>
          {compact ? (
            <div className="space-y-2">
              <WeekStrip value={draft.dayKey} todayKey={todayKey} onPick={(dayKey) => update({ dayKey })} />
              <EField label="Date">
                <EInput id="new-job-date" type="date" value={draft.dayKey} min={todayKey} aria-invalid={problemFields.has("date") || undefined} onChange={(event) => update({ dayKey: event.target.value })} className="text-[16px]" />
              </EField>
            </div>
          ) : null}
          {problemFields.has("date") ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Choose a date.</p> : null}
          {times}
          {problemFields.has("dueTime") ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Ready by {draft.dueTime} is before the start, {draft.startTime}.</p> : null}
          {compact ? <details className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"><summary className="min-h-[32px] cursor-pointer text-[0.875rem] font-[550]">Early check-in, late checkout <Faint>· {draft.earlyCheckin.preset === "none" && draft.lateCheckout.preset === "none" ? "None" : "Set"} · priority {draftPriority(draft)}</Faint></summary><div className="pt-3">{timing}</div></details> : timing}
          <DayFacts draft={draft} facts={facts} day={day} timezone={timezone} todayKey={todayKey} compact={compact} />
        </>
      ) : null}
      {draft.mode === "several" ? (
        <>
          {times}
          {timing}
          {severalSlot}
        </>
      ) : null}
      {draft.mode === "repeats" ? repeatsSlot : null}
    </div>
  );
}

function DayFacts({ draft, facts, day, timezone, todayKey, compact }: { draft: NewJobDraft; facts: ReadState<NewJobPropertyFacts>; day: ReadState<NewJobDayCheck>; timezone: string; todayKey: string; compact: boolean }) {
  if (!draft.propertyId) return <Faint>Choose a property to see its booking calendar for the day.</Faint>;
  if (!draft.dayKey) return <Faint>Choose a date to see the booking calendar and other jobs that day.</Faint>;
  if (day.status === "loading" && !day.data) return <Faint>Checking the calendar for {dayLabel(draft.dayKey)}…</Faint>;
  if (day.status === "error" && !day.data) {
    return (
      <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
        The calendar could not be checked: {day.error} <button type="button" className="underline" onClick={day.reload}>Try again</button>
      </p>
    );
  }
  const first = day.data?.days[0];
  if (!first) return null;
  return (
    <div className={day.stale ? "opacity-70" : undefined} aria-busy={day.status === "loading" || undefined}>
      {day.status === "error" ? <p role="alert" className="mb-1 text-[0.75rem] text-[hsl(var(--e-danger))]">Showing the last check; the newest one failed. <button type="button" className="underline" onClick={day.reload}>Try again</button></p> : null}
      <CalendarBand day={first} facts={facts.data} timezone={timezone} todayKey={todayKey} draft={draft} compact={compact} />
    </div>
  );
}
