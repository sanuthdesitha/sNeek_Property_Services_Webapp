"use client";

/**
 * Workforce › Leave and availability (board "Workforce" tab 3; phone list on
 * M-Workforce). A fortnight grid on desktop, a list by day on a phone, both
 * with "N jobs need cover" links into Jobs filtered to that person and those
 * days. Leave and days off already block the calendar, suggestions and
 * assignment (they need "Assign anyway"); the weekly "usually unavailable"
 * pattern is shown dashed and blocks nothing (owner default, pending owner
 * confirmation). "Add leave…" records through the existing leave route.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { cn } from "@/lib/utils";
import {
  cellFor,
  coverHref,
  coverWords,
  leaveByRange,
  patternWords,
  weekdayOf,
  type LeaveWindow,
  type TeamLeavePerson,
} from "@/lib/workforce/team-leave-model";

export type LeaveViewKey = "fortnight" | "next14" | "month" | "past";

const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

function dayNumber(key: string): string {
  return String(Number(key.slice(8, 10)));
}

function rangeWords(start: string, end: string): string {
  const format = (key: string, withWeekday: boolean) =>
    new Intl.DateTimeFormat("en-AU", { ...(withWeekday ? { weekday: "short" as const } : {}), day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
  return start === end ? format(start, true) : `${format(start, true)} – ${format(end, true)}`;
}

export function TeamLeaveView({
  people,
  window,
  view,
  previousHref,
  nextHref,
  todayKey,
  canRecord,
}: {
  people: TeamLeavePerson[];
  window: LeaveWindow;
  view: LeaveViewKey;
  previousHref: string;
  nextHref: string;
  todayKey: string;
  canRecord: boolean;
}) {
  const phone = useIsPhone();
  const [adding, setAdding] = React.useState(false);
  const withLeave = people.filter((person) => person.leave.length > 0 || person.usuallyUnavailable.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {phone ? (
          <div role="radiogroup" aria-label="Which days" className="inline-flex w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-0.5">
            {([
              ["next14", "Next 14 days"],
              ["month", "This month"],
              ["past", "Past"],
            ] as const).map(([key, label]) => (
              <Link key={key} href={`/v2/admin/workforce/leave?view=${key}`} role="radio" aria-checked={view === key || (key === "next14" && view === "fortnight")}
                className={cn("flex min-h-11 flex-1 items-center justify-center rounded-[calc(var(--e-radius)-2px)] text-[0.8125rem]", view === key || (key === "next14" && view === "fortnight") ? "bg-[hsl(var(--e-surface))] font-[600] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]")}>
                {label}
              </Link>
            ))}
          </div>
        ) : (
          <>
            <EButton asChild variant="outline" size="icon"><Link href={previousHref} aria-label="Previous fortnight"><ChevronLeft className="h-4 w-4" /></Link></EButton>
            <span className="text-[0.875rem] font-[600]">{rangeWords(window.start, window.end)}</span>
            <EButton asChild variant="outline" size="icon"><Link href={nextHref} aria-label="Next fortnight"><ChevronRight className="h-4 w-4" /></Link></EButton>
            <EButton asChild variant="ghost" size="sm"><Link href="/v2/admin/workforce/leave">This fortnight</Link></EButton>
            <span className="ml-auto flex flex-wrap items-center gap-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-4 rounded-sm bg-[hsl(var(--e-band-info-bg))] ring-1 ring-[hsl(var(--e-band-info-line))]" />Leave</span>
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-4 rounded-sm bg-[repeating-linear-gradient(135deg,hsl(var(--e-border-strong))_0_2px,transparent_2px_6px)]" />Day off</span>
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-4 rounded-sm border border-dashed border-[hsl(var(--e-border-strong))]" />Usually unavailable</span>
            </span>
          </>
        )}
        {canRecord ? (
          <EButton size="sm" onClick={() => setAdding(true)} className={cn(phone && "w-full")}>
            <Plus className="h-4 w-4" /> Add leave…
          </EButton>
        ) : null}
      </div>

      {phone ? (
        <PhoneLeaveList people={people} />
      ) : (
        <div role="region" aria-label="Team leave by day" tabIndex={0} className="overflow-x-auto rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-[0.75rem]">
            <thead>
              <tr className="border-b border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))]">
                <th scope="col" className="w-40 px-3 py-2 text-left font-[550]">Person</th>
                {window.days.map((day) => (
                  <th key={day} scope="col" className={cn("px-1 py-2 text-center font-[550]", day === todayKey && "text-[hsl(var(--e-primary))]")}>
                    <span aria-hidden>{WEEKDAY_LETTER[weekdayOf(day)]} {dayNumber(day)}</span>
                    <span className="sr-only">{rangeWords(day, day)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.length === 0 ? (
                <tr><td colSpan={window.days.length + 1} className="p-4 text-[0.875rem]">No active cleaners or laundry staff.</td></tr>
              ) : (
                people.map((person) => <GridRow key={person.id} person={person} window={window} />)
              )}
            </tbody>
          </table>
        </div>
      )}

      {!phone && withLeave.length === 0 && people.length > 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No leave, days off or weekly patterns recorded for these days.</p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[0.8125rem]">
          <h2 className="mb-1 text-[0.875rem] font-semibold">What leave changes</h2>
          <p className="text-[hsl(var(--e-muted-foreground))]">Leave and days off already block the calendar, cleaner suggestions and assignment (they need &ldquo;Assign anyway&rdquo;). &ldquo;Jobs need cover&rdquo; opens those jobs in Jobs, filtered to the person and the days.</p>
        </div>
        <div className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-4 text-[0.8125rem]">
          <h2 className="mb-1 text-[0.875rem] font-semibold">Usually unavailable</h2>
          <p className="text-[hsl(var(--e-muted-foreground))]">A weekly pattern per person (&ldquo;Sundays&rdquo;) from the availability records. Shown only: it does not block suggestions or assignment until the owner decides it should.</p>
        </div>
      </div>

      {adding ? <AddLeaveDialog people={people} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function GridRow({ person, window }: { person: TeamLeavePerson; window: LeaveWindow }) {
  const cells: React.ReactNode[] = [];
  for (let index = 0; index < window.days.length; index += 1) {
    const day = window.days[index];
    const cell = cellFor(person, day, window.start);
    if (cell.kind === "leave" && cell.first) {
      // One block across the days of the leave inside the window.
      let span = 1;
      while (index + span < window.days.length && window.days[index + span] <= cell.entry.endDate) span += 1;
      const cover = coverWords(cell.entry.jobsNeedingCover);
      const label = cell.entry.kind === "DAY_OFF" ? (span > 1 ? "Days off" : "Day off") : "Leave";
      cells.push(
        <td key={day} colSpan={span} className="p-0.5">
          <div className={cn(
            "flex min-h-10 flex-col justify-center rounded-[4px] px-1.5 py-1 leading-tight",
            cell.entry.kind === "DAY_OFF"
              ? "bg-[repeating-linear-gradient(135deg,hsl(var(--e-border))_0_2px,transparent_2px_7px)] text-[hsl(var(--e-muted-foreground))]"
              : "bg-[hsl(var(--e-band-info-bg))] text-[hsl(var(--e-band-info-fg))] ring-1 ring-inset ring-[hsl(var(--e-band-info-line))]",
          )}>
            <span className="truncate font-[600]" title={cell.entry.note ?? undefined}>{label}{span > 2 ? `, ${rangeWords(cell.entry.startDate, cell.entry.endDate)}` : ""}</span>
            {cover ? <Link href={coverHref(cell.entry)} className="truncate underline underline-offset-2">{cover}</Link> : null}
          </div>
        </td>,
      );
      index += span - 1;
      continue;
    }
    cells.push(
      <td key={day} className="p-0.5">
        {cell.kind === "usual" ? (
          <div className="flex min-h-10 items-center justify-center rounded-[4px] border border-dashed border-[hsl(var(--e-border-strong))] px-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]" title={patternWords(cell.pattern)}>
            <span className="truncate">Usual</span>
          </div>
        ) : null}
      </td>,
    );
  }
  return (
    <tr className="border-b border-[hsl(var(--e-border))] last:border-0">
      <th scope="row" className="truncate px-3 py-1.5 text-left text-[0.8125rem] font-[550]">{person.name}</th>
      {cells}
    </tr>
  );
}

function PhoneLeaveList({ people }: { people: TeamLeavePerson[] }) {
  const groups = leaveByRange(people);
  const patterns = people.filter((person) => person.usuallyUnavailable.length > 0);
  if (groups.length === 0 && patterns.length === 0) {
    return <p className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[0.875rem]">No leave or days off recorded for these days.</p>;
  }
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={`${group.startDate}:${group.endDate}`} aria-label={rangeWords(group.startDate, group.endDate)}>
          <h2 className="mb-1.5 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">{rangeWords(group.startDate, group.endDate)}</h2>
          <ul className="space-y-2">
            {group.items.map(({ person, entry }) => {
              const cover = coverWords(entry.jobsNeedingCover);
              return (
                <li key={entry.id} className="flex items-center gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
                  <span aria-hidden className={cn("h-3.5 w-3.5 shrink-0 rounded-sm", entry.kind === "DAY_OFF" ? "bg-[repeating-linear-gradient(135deg,hsl(var(--e-border-strong))_0_2px,transparent_2px_5px)] ring-1 ring-[hsl(var(--e-border-strong))]" : "bg-[hsl(var(--e-band-info-bg))] ring-1 ring-[hsl(var(--e-band-info-line))]")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-[600]">{person.name}</span>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
                      {entry.kind === "DAY_OFF" ? "Day off" : "Leave"}{entry.note ? ` · “${entry.note}”` : ""}{entry.jobsNeedingCover === 0 ? " · no jobs affected" : ""}
                    </span>
                  </span>
                  {cover && entry.jobsNeedingCover ? (
                    <Link href={coverHref(entry)} className="inline-flex min-h-11 shrink-0 items-center text-[0.8125rem] font-[600] text-[hsl(var(--e-primary))] underline underline-offset-2">{cover} ›</Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {patterns.length > 0 ? (
        <section aria-label="Usually unavailable">
          <h2 className="mb-1.5 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">Usually unavailable · shown only</h2>
          <ul className="space-y-2">
            {patterns.map((person) => (
              <li key={person.id} className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] p-3 text-[0.8125rem]">
                <span className="font-[600]">{person.name}</span> · {person.usuallyUnavailable.map(patternWords).join(", ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function AddLeaveDialog({ people, onClose }: { people: TeamLeavePerson[]; onClose: () => void }) {
  const router = useRouter();
  const [userId, setUserId] = React.useState(people[0]?.id ?? "");
  const [kind, setKind] = React.useState<"LEAVE" | "DAY_OFF">("LEAVE");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    if (!userId || !startDate || !endDate) return setError("Choose the person and the first and last day.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, kind, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(`Not recorded: ${typeof body?.error === "string" ? body.error : "try again."}`);
      onClose();
      router.refresh();
    } catch {
      setError("Not recorded: the connection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EModal open onClose={onClose} title="Add leave" eyebrow="Leave and availability">
      <fieldset disabled={busy} className="space-y-4">
        <EField label="Team member">
          <ESelect value={userId} onChange={(event) => setUserId(event.target.value)}>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </ESelect>
        </EField>
        <EField label="Kind">
          <ESelect value={kind} onChange={(event) => setKind(event.target.value === "DAY_OFF" ? "DAY_OFF" : "LEAVE")}>
            <option value="LEAVE">Leave</option>
            <option value="DAY_OFF">Day off</option>
          </ESelect>
        </EField>
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="First day"><EInput type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></EField>
          <EField label="Last day"><EInput type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></EField>
        </div>
        <EField label="Note, optional"><ETextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Family in Perth" /></EField>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Their assigned jobs on these days stay assigned; &ldquo;jobs need cover&rdquo; shows them.</p>
        {error ? <p role="alert" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <EButton variant="outline" size="sm" onClick={onClose}>Cancel</EButton>
          <EButton size="sm" onClick={() => void submit()}>{busy ? "Recording…" : "Record leave"}</EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
