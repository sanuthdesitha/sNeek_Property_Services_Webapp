"use client";

/**
 * "Several dates, same property": a month calendar to pick days (replacing
 * typed "2026-11-24 10:00 15:00" lines, which stay under "Paste lines"), and
 * a row per day with its times, what the booking calendar says and the
 * laundry preview. A day that already has a job is skipped unless the office
 * ticks it. One request key per batch: a retry creates only missing days.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import { addDays, dayLabel, parsePasteLines, type NewJobDraft, type SeveralDay } from "@/lib/jobs/new-job/draft";
import type { NewJobDay } from "@/lib/jobs/new-job/types";
import { Disclosure, Faint } from "./new-job-ui";
import { laundrySummary } from "./extras-sections";

export type SeveralDatesProps = {
  draft: NewJobDraft;
  update: (patch: Partial<NewJobDraft>) => void;
  days: NewJobDay[];
  dayStatus: "idle" | "loading" | "ready" | "error";
  todayKey: string;
  includeClashDays: ReadonlySet<string>;
  setIncludeClash: (dayKey: string, include: boolean) => void;
  compact?: boolean;
};

const MAX_DAYS = 31;

function monthGrid(monthKey: string): string[] {
  const first = `${monthKey}-01`;
  const firstDate = new Date(`${first}T00:00:00.000Z`);
  const offset = (firstDate.getUTCDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function SeveralDates({ draft, update, days, dayStatus, todayKey, includeClashDays, setIncludeClash, compact = false }: SeveralDatesProps) {
  const [month, setMonth] = useState(() => (draft.severalDays[0]?.dayKey ?? todayKey).slice(0, 7));
  const [paste, setPaste] = useState(draft.pasteLines);
  const picked = useMemo(() => new Map(draft.severalDays.map((day) => [day.dayKey, day])), [draft.severalDays]);
  const byKey = useMemo(() => new Map(days.map((day) => [day.dayKey, day])), [days]);
  const grid = monthGrid(month);
  const parsedPaste = parsePasteLines(paste);
  const monthTitle = new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", month: "long", year: "numeric" });

  function toggle(dayKey: string) {
    if (picked.has(dayKey)) {
      update({ severalDays: draft.severalDays.filter((day) => day.dayKey !== dayKey) });
      return;
    }
    if (draft.severalDays.length >= MAX_DAYS) return;
    update({ severalDays: [...draft.severalDays, { dayKey, startTime: draft.startTime, dueTime: draft.dueTime }].sort((a, b) => a.dayKey.localeCompare(b.dayKey)) });
  }

  function setDay(dayKey: string, patch: Partial<SeveralDay>) {
    update({ severalDays: draft.severalDays.map((day) => (day.dayKey === dayKey ? { ...day, ...patch } : day)) });
  }

  function addPasted() {
    const merged = new Map(draft.severalDays.map((day) => [day.dayKey, day]));
    for (const line of parsedPaste.valid) {
      merged.set(line.dayKey, { dayKey: line.dayKey, startTime: line.startTime ?? draft.startTime, dueTime: line.dueTime ?? draft.dueTime, endTime: line.endTime });
    }
    const next = Array.from(merged.values()).sort((a, b) => a.dayKey.localeCompare(b.dayKey)).slice(0, MAX_DAYS);
    update({ severalDays: next, pasteLines: paste });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Faint>Replaces typed lines like &quot;2026-11-24 10:00 15:00&quot;; the typed box stays under &quot;Paste lines&quot;.</Faint>
        <span className="rounded-full bg-[hsl(var(--e-muted))] px-2 py-0.5 text-[0.75rem]">{draft.severalDays.length} picked</span>
      </div>
      <div className="grid gap-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[0.875rem] font-[600]" aria-live="polite">{monthTitle}</p>
            <div className="flex gap-1">
              <EButton type="button" variant="ghost" size="sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</EButton>
              <EButton type="button" variant="ghost" size="sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</EButton>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[0.6875rem] text-[hsl(var(--e-text-secondary))]" aria-hidden>
            {["M", "T", "W", "T", "F", "S", "S"].map((letter, index) => <span key={index}>{letter}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1" role="group" aria-label={`Pick dates in ${monthTitle}`}>
            {grid.map((dayKey) => {
              const inMonth = dayKey.slice(0, 7) === month;
              const on = picked.has(dayKey);
              const past = dayKey < todayKey;
              const clash = (byKey.get(dayKey)?.sameDayJobs.length ?? 0) > 0;
              return (
                <button
                  key={dayKey}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${dayLabel(dayKey, true)}${clash ? ", already has a job" : ""}`}
                  disabled={past}
                  onClick={() => toggle(dayKey)}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-full text-[0.8125rem] max-sm:h-11 disabled:opacity-30",
                    !inMonth && "text-[hsl(var(--e-text-faint))]",
                    on ? "bg-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary-foreground))]" : "hover:bg-[hsl(var(--e-muted))]",
                    clash && !on && "bg-[hsl(var(--e-band-problem-bg))]",
                  )}
                >
                  {Number(dayKey.slice(8))}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Picked dates are filled; a tinted day already has a job at this property (once picked). At most {MAX_DAYS} dates.</p>
        </div>
        <div className="min-w-0">
          {draft.severalDays.length === 0 ? (
            <Faint>Pick the dates on the calendar.</Faint>
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]" role="region" aria-label="Picked dates" tabIndex={0}>
              <table className="w-full min-w-[34rem] text-[0.8125rem]">
                <thead className="bg-[hsl(var(--e-muted))] text-left text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  <tr><th className="px-2 py-1.5 font-[550]">Date</th><th className="px-2 py-1.5 font-[550]">Start</th><th className="px-2 py-1.5 font-[550]">Ready by</th><th className="px-2 py-1.5 font-[550]">Calendar</th><th className="px-2 py-1.5 font-[550]">Laundry preview</th></tr>
                </thead>
                <tbody>
                  {draft.severalDays.map((row) => {
                    const facts = byKey.get(row.dayKey);
                    const existing = facts?.sameDayJobs[0];
                    const included = includeClashDays.has(row.dayKey);
                    const skipped = Boolean(existing) && !included;
                    const created = draft.created.find((record) => record.dayKey === row.dayKey);
                    return (
                      <tr key={row.dayKey} className="border-t border-[hsl(var(--e-border))] align-top">
                        <td className={cn("px-2 py-1.5", existing && "bg-[hsl(var(--e-band-problem-bg))]")}>
                          <p className="font-[550]">{dayLabel(row.dayKey)}</p>
                          {existing ? (
                            <label className="mt-1 flex items-center gap-1 text-[0.75rem]">
                              <input type="checkbox" checked={included} onChange={(event) => setIncludeClash(row.dayKey, event.target.checked)} />
                              already {existing.jobNumber}; create anyway
                            </label>
                          ) : null}
                          {created ? <p className="text-[0.75rem] text-[hsl(var(--e-band-good-fg))]">{created.jobNumber ?? "Created"} created</p> : null}
                          <button type="button" className="text-[0.75rem] underline" onClick={() => toggle(row.dayKey)}>Remove</button>
                        </td>
                        <td className="px-2 py-1.5"><EInput type="time" aria-label={`Start on ${dayLabel(row.dayKey)}`} value={row.startTime} onChange={(event) => setDay(row.dayKey, { startTime: event.target.value })} className="h-9 w-[6.5rem]" /></td>
                        <td className="px-2 py-1.5"><EInput type="time" aria-label={`Ready by on ${dayLabel(row.dayKey)}`} value={row.dueTime} onChange={(event) => setDay(row.dayKey, { dueTime: event.target.value })} className="h-9 w-[6.5rem]" /></td>
                        <td className="px-2 py-1.5">
                          {!facts ? <Faint>{dayStatus === "error" ? "Not checked" : "Checking…"}</Faint> : facts.guestIn?.time ? `Guest in ${facts.guestIn.time}` : facts.guestIn ? "Guest in, time not given" : "No booking found"}
                        </td>
                        <td className="px-2 py-1.5">{skipped ? "Skipped: not created" : facts ? laundrySummary(facts.laundry).replace("Preview: ", "") : "…"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <Disclosure summary="Paste lines">
        <label htmlFor="new-job-paste" className="text-[0.8125rem]">One per line: YYYY-MM-DD [start HH:mm] [ready by HH:mm] [end HH:mm]</label>
        <ETextarea id="new-job-paste" value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={"2026-11-24\n2026-11-26 10:00 15:00"} className="min-h-[5rem]" />
        {parsedPaste.invalid.length ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{parsedPaste.invalid.length} line{parsedPaste.invalid.length === 1 ? "" : "s"} not understood: {parsedPaste.invalid.slice(0, 3).join("; ")}</p> : null}
        <EButton type="button" size="sm" variant="outline" disabled={parsedPaste.valid.length === 0} onClick={addPasted}>Add {parsedPaste.valid.length || ""} date{parsedPaste.valid.length === 1 ? "" : "s"}</EButton>
      </Disclosure>
      <Faint>One request key per batch. If the connection drops, Retry creates only the missing ones and never a second copy.</Faint>
    </div>
  );
}
