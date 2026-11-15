"use client";

/**
 * Deep-clean scheduling (board "Deep clean", 2026-11-16).
 *
 * Shows the existing rule step by step, the queue of stored plans with the
 * due date, baseline job and who verified it, a date panel with a small
 * calendar marked with guests staying and turnovers booked (from stored
 * bookings and jobs), verifying a baseline, summary tiles, a property's
 * history and the properties with no verified deep clean.
 *
 * The rule is unchanged: the same routes verify (POST action "verify") and
 * create the one draft job (POST action "schedule", idempotent for the same
 * day). Only administrators verify and choose the day; operations managers
 * see the panels read only. Opening another property cancels the old reads,
 * so its dates never fill this panel; a failed save keeps the chosen date.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { EButton, ECard, EPageHeader, EStatCard } from "@/components/v2/ui/primitives";
import { EToneRowCell, ETonePill, toneMutedClass, toneNoticeClass, tonePhoneBandClass } from "@/components/v2/ui/tone-band";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { CollapsibleFigures } from "@/components/v2/ui/collapsible-figures";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { addCalendarMonths } from "@/lib/properties/cadence-ledger";
import { DEEP_CLEAN_CADENCE_MONTHS } from "@/lib/scheduling-rules/constants";
import {
  QUEUE_STATE_WORDS,
  dueBand,
  dueWords,
  type Candidate,
  type DayMarks,
  type DeepCleanQueue,
  type HistoryEntry,
  type QueueRow,
} from "@/lib/properties/deep-clean-queue-model";

const MUTED = "text-[hsl(var(--e-muted-foreground))]";
const H2 = "font-[family-name:var(--e-font-serif)] text-[1.375rem] font-medium leading-tight";
const TZ = "Australia/Sydney";
const PAGE_SIZE = 20;

/* ── Dates (calendar days, never shifted by the viewer's time zone) ─────── */

function dayLabel(day: string, withYear = false): string {
  return formatInTimeZone(new Date(`${day}T12:00:00Z`), "UTC", withYear ? "EEE d MMM yyyy" : "EEE d MMM");
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return addDays(day, -((date.getUTCDay() + 6) % 7));
}

function historyTime(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, "d MMM HH:mm");
}

/* ── Data ───────────────────────────────────────────────────────────────── */

type QueueState = { status: "loading" } | { status: "failed" } | { status: "ready"; data: DeepCleanQueue };

type PlanDetail = {
  plan: {
    revision: number;
    baseline: null | { jobId: string; completedDay: string; dueDay: string; verifiedAt: string; reviewNote: string };
    proposal: null | { id: string; status: string; dueDay: string; jobId: string | null; scheduledDay: string | null };
  };
  baselineValid: boolean;
  today: string;
  canManage: boolean;
  candidateDetails: Candidate[];
  history: HistoryEntry[];
  changeReason: string | null;
};

type DetailState = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; detail: PlanDetail };

function usePlanDetail(propertyId: string | null, reloadKey: number): DetailState | null {
  const [state, setState] = React.useState<DetailState | null>(null);
  React.useEffect(() => {
    if (!propertyId) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/properties/${encodeURIComponent(propertyId)}/deep-clean-planning?detail=1`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (PlanDetail & { error?: string; property?: { id: string } }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.plan) throw new Error(body?.error ?? "Deep-clean planning could not be loaded.");
        // A late answer for another property never fills this panel.
        if (body.property && body.property.id !== propertyId) return;
        setState({ status: "ready", detail: body });
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: "failed", message: error instanceof Error ? error.message : "Deep-clean planning could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [propertyId, reloadKey]);
  return state;
}

function useDayMarks(propertyId: string | null, from: string, to: string): DayMarks | "failed" | null {
  const [marks, setMarks] = React.useState<DayMarks | "failed" | null>(null);
  React.useEffect(() => {
    if (!propertyId) return;
    const controller = new AbortController();
    setMarks(null);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/properties/${encodeURIComponent(propertyId)}/deep-clean-planning/calendar?from=${from}&to=${to}`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as DayMarks | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.guests)) throw new Error("failed");
        setMarks(body);
      } catch {
        if (!controller.signal.aborted) setMarks("failed");
      }
    })();
    return () => controller.abort();
  }, [propertyId, from, to]);
  return marks;
}

async function postPlanning(propertyId: string, payload: Record<string, unknown>): Promise<{ ok: true; body: { jobId?: string | null } } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/admin/properties/${encodeURIComponent(propertyId)}/deep-clean-planning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; jobId?: string | null } | null;
    if (!response.ok) return { ok: false, error: body?.error ?? "The server refused the change." };
    return { ok: true, body: body ?? {} };
  } catch {
    return { ok: false, error: "The server could not be reached." };
  }
}

/* ── Rule strip and tiles ───────────────────────────────────────────────── */

const STEPS: Array<{ title: string; text: string; yours?: boolean }> = [
  { title: "Deep clean done", text: "A completed Deep clean job with submitted photos or video." },
  { title: "You verify it", text: 'Check the evidence, write a note, tick "I reviewed it". This sets the baseline.', yours: true },
  { title: "Due date", text: `Baseline + ${DEEP_CLEAN_CADENCE_MONTHS} calendar months, Sydney dates. No baseline, no due date.` },
  { title: "Proposal appears", text: "On the due day; the daily check runs at 08:15. Undated." },
  { title: "You choose the day", text: "Creates one draft Deep clean job on that date.", yours: true },
  { title: "Normal job", text: "Assign, price and tell the client from the job page, as for any job." },
];

function RuleStrip() {
  const phone = useIsPhone();
  return (
    <details className="group rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] sm:border-0 sm:bg-transparent" open={!phone}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-[0.875rem] font-semibold sm:hidden">
        How the rule works <span aria-hidden className="group-open:rotate-90">▸</span>
      </summary>
      <ol className="grid grid-cols-1 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[0.8125rem] sm:grid-cols-3 xl:grid-cols-6" aria-label="The deep-clean rule">
        {STEPS.map((step, index) => (
          <li key={step.title} className={cn("p-3", index > 0 && "border-t border-[hsl(var(--e-border))] xl:border-l xl:border-t-0", step.yours && "bg-[hsl(var(--e-band-attention-bg))]")}>
            <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full text-[0.6875rem] font-semibold", step.yours ? "bg-[hsl(var(--e-gold))] text-[hsl(var(--e-surface))]" : "bg-[hsl(var(--e-surface-raised))]")}>{index + 1}</span>
            <p className="mt-1 font-semibold">{step.title}{step.yours ? <span className="sr-only"> (your step)</span> : null}</p>
            <p className={cn("mt-1", MUTED)}>{step.text}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Tiles({ queue }: { queue: DeepCleanQueue | null }) {
  const tiles = queue?.tiles;
  const value = (count: number | undefined) => (count === undefined ? "–" : String(count));
  return (
    <CollapsibleFigures storageKey="deep-clean-scheduling" count={5} label="Deep-clean figures">
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <EStatCard label="Needs a date" value={value(tiles?.needsDate)} delta={tiles?.oldestDue ? `oldest due ${dayLabel(tiles.oldestDue)}` : tiles ? "none waiting" : undefined} deltaTone="neutral" />
        <EStatCard label="Evidence changed" value={value(tiles?.evidenceChanged)} delta={tiles ? "re-verify before scheduling" : undefined} deltaTone={tiles?.evidenceChanged ? "danger" : "neutral"} />
        <EStatCard label="Due later" value={value(tiles?.dueLater)} delta={tiles?.nextDue ? `next ${dayLabel(tiles.nextDue)}` : undefined} deltaTone="neutral" />
        <EStatCard label="Draft job created" value={value(tiles?.draftCreated)} delta={tiles ? `${tiles.draftUnassigned} still unassigned` : undefined} deltaTone="neutral" />
        <EStatCard label="No verified deep clean" value={value(tiles?.noBaseline)} delta={tiles ? "due date unknown" : undefined} deltaTone="neutral" />
      </div>
    </CollapsibleFigures>
  );
}

/* ── Queue ──────────────────────────────────────────────────────────────── */

function statePill(row: QueueRow) {
  const tone = row.state === "evidence_changed" || row.state === "needs_review" ? "problem" : row.state === "needs_date" || row.state === "awaiting_check" ? "attention" : row.state === "draft_created" ? "good" : "info";
  return <ETonePill tone={tone} className="border border-[hsl(var(--e-border))]">{QUEUE_STATE_WORDS[row.state]}</ETonePill>;
}

function rowAction(row: QueueRow, onChoose: () => void, onVerify: () => void, disabled: boolean, canManage: boolean) {
  if (row.state === "draft_created" && row.proposal?.jobId) {
    return <Link href={`/v2/admin/jobs/${row.proposal.jobId}`} className="text-[0.8125rem] font-medium underline underline-offset-2">Open job</Link>;
  }
  if (row.state === "evidence_changed") {
    return <EButton size="sm" variant="outline" onClick={onVerify} disabled={disabled}>{canManage ? "Re-verify…" : "View evidence…"}</EButton>;
  }
  if (row.state === "needs_date") {
    return <EButton size="sm" variant="outline" onClick={onChoose} disabled={disabled}>{canManage ? "Choose date…" : "View…"}</EButton>;
  }
  return <EButton size="sm" variant="ghost" onClick={onChoose} disabled={disabled}>Details</EButton>;
}

function BaselineCell({ row }: { row: QueueRow }) {
  if (!row.baseline) return <span className={MUTED}>No verified deep clean</span>;
  return (
    <span className="block min-w-0">
      <Link href={`/v2/admin/jobs/${row.baseline.jobId}`} className="underline underline-offset-2">{row.baseline.jobNumber ?? "Job"}</Link> · {dayLabel(row.baseline.completedDay)}
      <span className={cn("block text-[0.75rem]", row.changeReason ? "text-[hsl(var(--e-band-problem-fg))]" : MUTED)}>
        {row.changeReason ?? `verified by ${row.baseline.verifiedByName}, ${formatInTimeZone(new Date(row.baseline.verifiedAt), TZ, "EEE d MMM")}`}
      </span>
    </span>
  );
}

function QueueTable({ rows, today, selected, onChoose, onVerify, frozen, canManage }: {
  rows: QueueRow[];
  today: string;
  selected: string | null;
  onChoose: (id: string) => void;
  onVerify: (id: string) => void;
  frozen: boolean;
  canManage: boolean;
}) {
  return (
    <>
      <div className="overflow-x-auto max-sm:hidden" role="region" aria-label="Deep-clean queue" tabIndex={0}>
        <table className="w-full min-w-[600px] text-left text-[0.8125rem]">
          <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Property</th>
              <th scope="col" className="px-3 py-2 font-medium">Last verified deep clean</th>
              <th scope="col" className="px-3 py-2 font-medium">Due</th>
              <th scope="col" className="px-3 py-2 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const band = dueBand(row.state, row.dueDay, today);
              const tone = row.state === "evidence_changed" || band === "overdue" ? "problem" : band === "today" ? "attention" : null;
              const words = row.state === "evidence_changed" ? "Re-verify" : dueWords(row.dueDay, today);
              return (
                <tr key={row.propertyId} className={cn("border-t border-[hsl(var(--e-border))] align-top", selected === row.propertyId && "bg-[hsl(var(--e-primary)/0.08)]")} data-queue-row={row.propertyId}>
                  <EToneRowCell tone={selected === row.propertyId ? null : tone} className="px-3 py-2.5">
                    <span className="font-semibold">{row.propertyName}</span>
                    {tone && words ? <span className="ml-1.5 inline-flex rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-surface))] px-2 text-[0.6875rem] font-semibold">{words}</span> : null}
                    <span className={cn("block text-[0.75rem]", tone ? toneMutedClass(tone) : MUTED)}>
                      {[row.clientName, row.bedrooms ? `${row.bedrooms} bed` : null, row.suburb].filter(Boolean).join(" · ")}
                    </span>
                  </EToneRowCell>
                  <td className="px-3 py-2.5"><BaselineCell row={row} /></td>
                  <td className="px-3 py-2.5">{row.dueDay ? dayLabel(row.dueDay) : "Unknown"}</td>
                  <td className="px-3 py-2.5">
                    {statePill(row)}
                    {row.state === "draft_created" && row.proposal ? (
                      <span className={cn("block text-[0.75rem]", MUTED)}>
                        {row.proposal.jobNumber ?? "Job"} · {row.proposal.scheduledDay ? dayLabel(row.proposal.scheduledDay) : ""} · {row.proposal.assigned ? "assigned" : "unassigned"}
                      </span>
                    ) : null}
                    <div className="mt-1.5">{rowAction(row, () => onChoose(row.propertyId), () => onVerify(row.propertyId), frozen, canManage)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 p-2 sm:hidden" aria-label="Deep-clean queue">
        {rows.map((row) => {
          const band = dueBand(row.state, row.dueDay, today);
          const tone = row.state === "evidence_changed" || band === "overdue" ? "problem" : band === "today" ? "attention" : null;
          return (
            <li key={row.propertyId} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] text-[0.8125rem]">
              <div className={cn("flex items-start justify-between gap-2 px-3 py-2", tone && tonePhoneBandClass(tone))}>
                <span className="min-w-0">
                  <span className="block font-semibold">{row.propertyName}</span>
                  <span className={cn("block text-[0.75rem]", MUTED)}>{row.clientName ?? row.suburb}</span>
                </span>
                {statePill(row)}
              </div>
              <div className="space-y-1.5 px-3 py-2">
                <BaselineCell row={row} />
                <p>Due {row.dueDay ? dayLabel(row.dueDay) : "unknown"}{dueWords(row.dueDay, today) && tone ? ` · ${dueWords(row.dueDay, today)}` : ""}</p>
                <div>{rowAction(row, () => onChoose(row.propertyId), () => onVerify(row.propertyId), frozen, canManage)}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ── Choose the day ─────────────────────────────────────────────────────── */

function Calendar({ start, today, selected, marks, onSelect, disabled }: {
  start: string;
  today: string;
  selected: string | null;
  marks: DayMarks | null;
  onSelect: (day: string) => void;
  disabled: boolean;
}) {
  const days = Array.from({ length: 35 }, (_, index) => addDays(start, index));
  const guests = new Set(marks?.guests ?? []);
  const turnovers = new Set(marks?.turnovers ?? []);
  return (
    <div role="grid" aria-label="Service date" className="text-center text-[0.75rem]">
      <div role="row" className="grid grid-cols-7 gap-1 pb-1">
        {["M", "T", "W", "T", "F", "S", "S"].map((letter, index) => <span key={index} role="columnheader" className={cn("font-semibold", MUTED)}>{letter}</span>)}
      </div>
      {[0, 1, 2, 3, 4].map((week) => (
        <div key={week} role="row" className="grid grid-cols-7 gap-1 pb-1">
          {days.slice(week * 7, week * 7 + 7).map((day) => {
            const past = day < today;
            const isSelected = day === selected;
            const staying = guests.has(day);
            const turnover = turnovers.has(day);
            const label = `${dayLabel(day, true)}${past ? ", past, cannot be chosen" : ""}${staying ? ", guests staying" : ""}${turnover ? ", turnover booked" : ""}`;
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                aria-label={label}
                aria-selected={isSelected}
                disabled={past || disabled}
                onClick={() => onSelect(day)}
                className={cn(
                  "relative h-9 rounded-[var(--e-radius-sm)] border text-[0.8125rem] max-sm:h-11",
                  past ? "border-transparent text-[hsl(var(--e-text-faint))]" : "border-[hsl(var(--e-border))]",
                  staying && !isSelected && "bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]",
                  turnover && !isSelected && !staying && "bg-[hsl(var(--e-band-good-bg))]",
                  isSelected && "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] font-semibold text-[hsl(var(--e-primary-foreground))]",
                )}
              >
                {Number(day.slice(8))}
                {turnover ? <span aria-hidden className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current" /> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ChoosePanel({ row, detail, onCreated, onSaving }: { row: QueueRow; detail: DetailState | null; onCreated: () => void; onSaving: (saving: boolean) => void }) {
  const ready = detail?.status === "ready" ? detail.detail : null;
  const today = ready?.today ?? null;
  const [start, setStart] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ jobId: string | null; day: string } | null>(null);
  React.useEffect(() => {
    if (today && !start) setStart(mondayOf(today));
  }, [today, start]);
  const from = start ?? "2000-01-03";
  const to = addDays(from, 34);
  const marks = useDayMarks(start ? row.propertyId : null, from, to);

  if (!detail || detail.status === "loading") return <p role="status" className="text-[0.875rem]">Loading {row.propertyName}…</p>;
  if (detail.status === "failed") return <p role="alert" className="text-[0.875rem]">{detail.message}</p>;
  const plan = ready!.plan;
  const proposal = plan.proposal;
  const canManage = ready!.canManage;
  const markSet = marks && marks !== "failed" ? marks : null;
  const selectedStaying = selected ? markSet?.guests.includes(selected) : false;
  const selectedTurnover = selected ? markSet?.turnovers.includes(selected) : false;

  async function create() {
    if (!selected || !proposal) return;
    setSaving(true);
    onSaving(true);
    setError(null);
    // The same request on Try again: the server returns the job already made for this day.
    const result = await postPlanning(row.propertyId, { action: "schedule", proposalId: proposal.id, revision: plan.revision, date: selected });
    setSaving(false);
    onSaving(false);
    if (!result.ok) {
      setError(`No job was created: ${result.error}`);
      return;
    }
    setCreated({ jobId: result.body.jobId ?? null, day: selected });
    onCreated();
  }

  return (
    <div className="space-y-4 text-[0.8125rem]">
      <p>
        {plan.baseline ? (
          <>Baseline <Link href={`/v2/admin/jobs/${plan.baseline.jobId}`} className="underline underline-offset-2">{row.baseline?.jobNumber ?? "job"}</Link>, {dayLabel(plan.baseline.completedDay)}{row.baseline ? `, verified by ${row.baseline.verifiedByName}` : ""}. </>
        ) : "No verified baseline. "}
        {plan.baseline ? (ready!.baselineValid ? "Evidence still matches what was verified." : `Evidence changed: ${ready!.changeReason ?? "re-verify before scheduling"}.`) : null}
      </p>
      {created ? (
        <div role="status" className={cn("rounded-[var(--e-radius)] p-3", toneNoticeClass("good"))}>
          Draft job created for {dayLabel(created.day)}. It has no cleaner, no client message and no charge yet.{" "}
          {created.jobId ? <Link href={`/v2/admin/jobs/${created.jobId}`} className="font-medium underline underline-offset-2">Open job</Link> : null}
        </div>
      ) : null}
      {proposal?.status === "SCHEDULED" ? (
        <p>A draft job already exists for {proposal.scheduledDay ? dayLabel(proposal.scheduledDay) : "this proposal"}. {proposal.jobId ? <Link href={`/v2/admin/jobs/${proposal.jobId}`} className="underline underline-offset-2">Open it</Link> : null} to change the date.</p>
      ) : proposal?.status === "NEEDS_SCHEDULING" && !created ? (
        <>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold">Service date</span>
              <span className="flex items-center gap-1">
                <EButton size="sm" variant="ghost" onClick={() => setStart((value) => (value ? addDays(value, -35) : value))} disabled={!start || !today || addDays(start, -1) < mondayOf(today)} aria-label="Earlier weeks">‹</EButton>
                <span className={MUTED}>{start ? `${dayLabel(from)} – ${dayLabel(to)}` : ""}</span>
                <EButton size="sm" variant="ghost" onClick={() => setStart((value) => (value ? addDays(value, 35) : value))} aria-label="Later weeks">›</EButton>
              </span>
            </div>
            {start && today ? <Calendar start={start} today={today} selected={selected} marks={markSet} onSelect={(day) => { setSelected(day); setError(null); }} disabled={!canManage || saving} /> : null}
            <p className={cn("mt-1 text-[0.75rem]", MUTED)}>
              {marks === "failed" ? "Bookings could not be read, so guests and turnovers are not marked." : marks === null ? "Reading bookings…" : (
                <>
                  <span className="mr-2 inline-block rounded px-1 bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]">blue</span>guests staying ·{" "}
                  <span className="mx-1 inline-block rounded px-1 bg-[hsl(var(--e-band-good-bg))]">• green</span>turnover booked · past days cannot be chosen
                </>
              )}
            </p>
          </div>
          {selected ? (
            <ECard className="p-3">
              <h3 className="font-semibold">{dayLabel(selected)}: what happens</h3>
              <ul className="mt-1 space-y-1">
                <li>✓ Creates one draft job, Deep clean, {row.propertyName}, {dayLabel(selected)}, Unassigned.</li>
                <li>✓ Pressing it twice, or retrying after a lost connection, never makes a second job.</li>
                <li>✕ Does not assign a cleaner, notify the client or add a charge.</li>
                <li>{selectedStaying || selectedTurnover ? "▲" : "✓"} {selectedStaying ? "Guests are staying that day. " : ""}{selectedTurnover ? "A turnover is booked that day. " : ""}{!selectedStaying && !selectedTurnover ? (markSet ? "No guests that day and no turnover booked." : "Bookings for that day are not known.") : ""}</li>
              </ul>
            </ECard>
          ) : null}
          {error ? <p role="alert" className="text-[hsl(var(--e-danger))]">{error} The chosen date is kept; Try again sends the same request.</p> : null}
          {canManage ? (
            <EButton className="w-full" onClick={() => void create()} disabled={!selected || saving || !ready!.baselineValid}>
              {saving ? "Creating…" : error ? "Try again" : selected ? `Create draft for ${dayLabel(selected)}` : "Choose a day"}
            </EButton>
          ) : null}
        </>
      ) : proposal?.status === "DEFERRED" || (plan.baseline && !proposal) ? (
        <p>Not due yet: the proposal appears on {plan.baseline ? dayLabel(plan.baseline.dueDay) : "the due day"}, when the daily check runs.</p>
      ) : null}
      <p className={cn("text-[0.75rem]", MUTED)}>
        {canManage ? "Only administrators choose dates and verify baselines." : "An administrator chooses the day. You see this panel read only."}
      </p>
      <HistoryList entries={ready!.history} name={row.propertyName} />
    </div>
  );
}

function HistoryList({ entries, name }: { entries: HistoryEntry[]; name: string }) {
  return (
    <section aria-label={`History, ${name}`} className="border-t border-[hsl(var(--e-border))] pt-3">
      <h3 className="font-semibold">History · {name}</h3>
      {entries.length ? (
        <ul className="mt-1 divide-y divide-[hsl(var(--e-border))]">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-1.5">
              <span className={MUTED}>{historyTime(entry.at)}</span>
              <span className="min-w-0 break-words">{entry.text}{entry.actor ? ` · ${entry.actor}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn("mt-1", MUTED)}>Nothing recorded yet.</p>
      )}
    </section>
  );
}

/* ── Verify ─────────────────────────────────────────────────────────────── */

function VerifySection({ propertyId, propertyName, detail, onVerified, onClose }: { propertyId: string; propertyName: string; detail: DetailState | null; onVerified: () => void; onClose: () => void }) {
  const [jobId, setJobId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [reviewed, setReviewed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  if (!detail || detail.status === "loading") return <p role="status" className="text-[0.875rem]">Loading the deep cleans at {propertyName}…</p>;
  if (detail.status === "failed") return <p role="alert" className="text-[0.875rem]">{detail.message}</p>;
  const ready = detail.detail;
  const chosen = ready.candidateDetails.find((candidate) => candidate.id === jobId) ?? null;
  const nextDue = chosen?.completedDay ? addCalendarMonths(chosen.completedDay, DEEP_CLEAN_CADENCE_MONTHS) : null;

  async function verify() {
    setSaving(true);
    setError(null);
    const result = await postPlanning(propertyId, { action: "verify", jobId, revision: ready.plan.revision, reviewNote: note.trim(), evidenceReviewed: true });
    setSaving(false);
    if (!result.ok) {
      setError(`Not verified: ${result.error}`);
      return;
    }
    setDone(`Baseline verified. ${nextDue ? `Next due ${dayLabel(nextDue)}.` : ""}`);
    setReviewed(false);
    onVerified();
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <ECard className="min-w-0 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="e-eyebrow">{propertyName} · baseline</p>
            <h3 className="font-[family-name:var(--e-font-serif)] text-[1.25rem]">Which deep clean counts?</h3>
          </div>
          {ready.plan.baseline && !ready.baselineValid ? <ETonePill tone="problem" className="border border-[hsl(var(--e-border))]">Evidence changed</ETonePill> : null}
        </div>
        {ready.plan.baseline && !ready.baselineValid && ready.changeReason ? <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-band-problem-fg))]">Since it was verified, {ready.changeReason}.</p> : null}
        <p className={cn("mt-1 text-[0.8125rem]", MUTED)}>The last 50 completed deep-clean jobs here. A job without submitted photos or video cannot be chosen; a job label or one matching photo is not proof.</p>
        {ready.candidateDetails.length === 0 ? (
          <p className="mt-3 text-[0.8125rem]">No completed deep clean is recorded at this property, so there is nothing to verify and the due date stays unknown.</p>
        ) : (
          <fieldset disabled={saving || !ready.canManage} className="mt-3 space-y-2">
            <legend className="sr-only">Completed deep cleans</legend>
            {ready.candidateDetails.map((candidate) => (
              <label key={candidate.id} className={cn("flex items-start gap-3 rounded-[var(--e-radius)] border p-3 text-[0.8125rem]", jobId === candidate.id ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.06)]" : "border-[hsl(var(--e-border))]", candidate.blocked && "bg-[hsl(var(--e-surface-raised))]")}>
                <input type="radio" name={`baseline-${propertyId}`} className="mt-1" value={candidate.id} checked={jobId === candidate.id} disabled={Boolean(candidate.blocked)} onChange={() => { setJobId(candidate.id); setReviewed(false); }} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{candidate.jobNumber} · {candidate.completedDay ? dayLabel(candidate.completedDay) : "no completion day"}</span>
                  {candidate.cleaners.length ? <span> · {candidate.cleaners.join(", ")}</span> : null}
                  <span className={cn("block", MUTED)}>
                    {candidate.blocked ? `Cannot be chosen: ${candidate.blocked}` : [
                      `${candidate.photos} ${candidate.photos === 1 ? "photo" : "photos"}`,
                      candidate.videos ? `${candidate.videos} ${candidate.videos === 1 ? "video" : "videos"}` : null,
                      candidate.qa ? `QA ${candidate.qa.passed ? "passed" : "failed"} ${candidate.qa.score}` : "no QA review",
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Link href={`/v2/admin/jobs/${candidate.id}`} target="_blank" rel="noreferrer" className="shrink-0 underline underline-offset-2">Open evidence ↗</Link>
              </label>
            ))}
          </fieldset>
        )}
      </ECard>
      <ECard className="min-w-0 p-4 text-[0.8125rem]">
        <p className="e-eyebrow">Your check</p>
        {ready.canManage ? (
          <fieldset disabled={saving} className="mt-2 space-y-3">
            <div>
              <label htmlFor={`note-${propertyId}`} className="mb-1 block text-[0.75rem] font-semibold">Verification note, required</label>
              <textarea id={`note-${propertyId}`} value={note} maxLength={2000} rows={3} onChange={(event) => setNote(event.target.value)} className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-2 text-[16px] sm:text-[0.8125rem]" />
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="mt-0.5" />
              I reviewed the evidence and confirm this was a completed deep clean.
            </label>
            <div className="flex flex-wrap gap-2">
              <EButton onClick={() => void verify()} disabled={!jobId || !note.trim() || !reviewed || saving}>{saving ? "Verifying…" : "Verify baseline"}</EButton>
              <EButton variant="ghost" onClick={onClose} disabled={saving}>Cancel</EButton>
            </div>
          </fieldset>
        ) : (
          <p className="mt-2">Only administrators verify baselines. You see this read only.</p>
        )}
        <div aria-live="polite" className="mt-2">
          {done ? <p>{done}</p> : null}
          {error ? <p role="alert" className="text-[hsl(var(--e-danger))]">{error} Your choice and note are kept.</p> : null}
        </div>
        <h3 className="mt-4 font-semibold">After verifying</h3>
        <p className="mt-1">
          {chosen && nextDue
            ? `${propertyName}'s next due date becomes ${dayLabel(nextDue, true)} (${dayLabel(chosen.completedDay!)} + ${DEEP_CLEAN_CADENCE_MONTHS} months). ${nextDue <= ready.today ? 'It is already past, so a proposal "Needs a date" appears straight away.' : 'It is in the future, so the proposal waits as "Due later" until then.'}`
            : `Choose a deep clean to see the next due date: its completion day + ${DEEP_CLEAN_CADENCE_MONTHS} calendar months.`}
        </p>
        <p className={cn("mt-2", MUTED)}>Verifying a newer deep clean replaces an undated proposal; the old one stays in the history as &quot;Replaced&quot;. A proposal that already has a draft job keeps it.</p>
      </ECard>
    </div>
  );
}

/* ── Screen ─────────────────────────────────────────────────────────────── */

export function DeepCleanScheduling() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("property");
  const verifyId = params.get("verify");
  const [queue, setQueue] = React.useState<QueueState>({ status: "loading" });
  const [stale, setStale] = React.useState(false);
  const [shown, setShown] = React.useState(PAGE_SIZE);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const controller = React.useRef<AbortController | null>(null);
  const hasData = React.useRef(false);
  hasData.current = queue.status === "ready";

  const load = React.useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setStale(false);
    try {
      const response = await fetch("/api/admin/deep-clean-planning/queue", { cache: "no-store", signal: current.signal });
      const body = (await response.json().catch(() => null)) as DeepCleanQueue | null;
      if (current.signal.aborted) return;
      if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error("failed");
      setQueue({ status: "ready", data: body });
    } catch {
      if (current.signal.aborted) return;
      if (hasData.current) setStale(true);
      else setQueue({ status: "failed" });
    }
  }, []);

  React.useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  const navigate = React.useCallback((change: { property?: string | null; verify?: string | null }) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(change)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const search = next.toString();
    router.replace(`/v2/admin/deep-clean-planning${search ? `?${search}` : ""}`, { scroll: false });
  }, [params, router]);

  const data = queue.status === "ready" ? queue.data : null;
  const rows = data?.rows ?? [];
  const selectedRow = rows.find((row) => row.propertyId === selectedId) ?? null;
  const panelDetail = usePlanDetail(selectedRow ? selectedRow.propertyId : null, reloadKey);
  const verifyName = rows.find((row) => row.propertyId === verifyId)?.propertyName ?? data?.noBaseline.find((row) => row.propertyId === verifyId)?.propertyName ?? null;
  const verifyDetail = usePlanDetail(verifyId && verifyName ? verifyId : null, reloadKey);
  const needDate = data?.tiles.needsDate ?? 0;
  const recheck = data?.tiles.evidenceChanged ?? 0;

  function refreshAll() {
    void load();
    setReloadKey((key) => key + 1);
  }

  const refreshButton = (
    <EButton variant="outline" onClick={refreshAll}>
      <RefreshCw aria-hidden className="h-4 w-4" /> Refresh
    </EButton>
  );

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations · Properties"
        title="Deep-clean scheduling"
        description={
          <>
            A property is due a deep clean {DEEP_CLEAN_CADENCE_MONTHS === 3 ? "three" : DEEP_CLEAN_CADENCE_MONTHS} Sydney calendar months after its last verified one. The office proposes; you choose the day.
            {data ? ` ${needDate} ${needDate === 1 ? "needs" : "need"} a date · ${recheck} ${recheck === 1 ? "needs" : "need"} re-checking.` : ""}
          </>
        }
        actions={<span className="max-sm:hidden">{refreshButton}</span>}
      />
      <RuleStrip />
      <Tiles queue={data} />

      {queue.status === "failed" ? (
        <div role="alert" className={cn("rounded-[var(--e-radius-lg)] p-4 text-[0.875rem]", toneNoticeClass("problem"))}>
          <p className="font-semibold">The queue could not be loaded.</p>
          <p className={toneMutedClass("problem")}>Nothing here says &quot;No deep cleans due&quot; until it loads.</p>
          <EButton size="sm" variant="outline" className="mt-2" onClick={() => { setQueue({ status: "loading" }); void load(); }}>Try again</EButton>
        </div>
      ) : null}
      {stale ? <p role="alert" className={cn("rounded-[var(--e-radius)] p-2 text-[0.8125rem]", toneNoticeClass("attention"))}>The latest read failed; these rows are from the previous one. <button type="button" className="underline" onClick={() => void load()}>Try again</button></p> : null}

      <div className={cn("grid min-w-0 grid-cols-1 gap-4", selectedRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
        <ECard className="min-w-0 overflow-hidden">
          {queue.status === "loading" ? (
            <div role="status" aria-label="Loading the queue" className="space-y-2 p-4">
              {[0, 1, 2].map((index) => <div key={index} className="h-8 animate-pulse rounded bg-[hsl(var(--e-surface-raised))] motion-reduce:animate-none" />)}
            </div>
          ) : data && rows.length === 0 ? (
            <p className="p-4 text-[0.875rem]">
              No property needs a date. {data.tiles.noBaseline} {data.tiles.noBaseline === 1 ? "property has" : "properties have"} no verified deep clean, so {data.tiles.noBaseline === 1 ? "its" : "their"} due date is unknown.
            </p>
          ) : data ? (
            <>
              <QueueTable rows={rows.slice(0, shown)} today={data.today} selected={selectedRow?.propertyId ?? null} onChoose={(id) => navigate({ property: id })} onVerify={(id) => navigate({ verify: id })} frozen={saving} canManage={data.canManage} />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] px-3 py-2 text-[0.75rem]">
                <span className={MUTED}>Sorted by due date, oldest first. Overdue rows have a wine band; due today a honey band; the reason is written beside the name.</span>
                {rows.length > shown ? <EButton size="sm" variant="outline" onClick={() => setShown((count) => count + PAGE_SIZE)}>Load more properties</EButton> : null}
              </div>
            </>
          ) : null}
        </ECard>
        {selectedRow ? (
          <ESidePanel
            open
            label="Choose the deep-clean day"
            title="Choose the deep-clean day"
            toolbar={<span className="e-eyebrow">{selectedRow.propertyName}{selectedRow.dueDay ? ` · due ${dayLabel(selectedRow.dueDay)}` : ""}</span>}
            onClose={() => { if (!saving) navigate({ property: null }); }}
          >
            <ChoosePanel key={selectedRow.propertyId} row={selectedRow} detail={panelDetail} onCreated={() => void load()} onSaving={setSaving} />
          </ESidePanel>
        ) : null}
      </div>

      {verifyId && verifyName ? (
        <section className="space-y-3" aria-labelledby="verify-title">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="verify-title" className={H2}>Verify a completed deep clean</h2>
            <p className={cn("text-[0.8125rem]", MUTED)}>{verifyName}: from &quot;Re-verify…&quot;, &quot;Find a deep clean&quot; or the property page&apos;s Deep-clean planning section.</p>
          </div>
          <VerifySection key={verifyId} propertyId={verifyId} propertyName={verifyName} detail={verifyDetail} onVerified={refreshAll} onClose={() => navigate({ verify: null })} />
        </section>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        <ECard className="min-w-0 p-4 text-[0.8125rem]">
          <h2 className="text-[0.9375rem] font-semibold">Properties with no verified deep clean · {data ? data.noBaseline.length : "–"}</h2>
          {data ? (
            data.noBaseline.length ? (
              <>
                <p className="mt-1">Their due date is unknown and is never guessed from a job title.</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {data.noBaseline.slice(0, 12).map((property) => (
                    <li key={property.propertyId}>
                      <button type="button" className="min-h-8 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-2.5 text-[0.75rem] max-sm:min-h-11" onClick={() => navigate({ verify: property.propertyId })}>
                        {property.propertyName}
                      </button>
                    </li>
                  ))}
                  {data.noBaseline.length > 12 ? <li className={cn("self-center", MUTED)}>and {data.noBaseline.length - 12} more</li> : null}
                </ul>
                <p className={cn("mt-2 text-[0.75rem]", MUTED)}>Choose one to find a deep clean to verify.</p>
              </>
            ) : (
              <p className="mt-1">Every active property has a verified deep clean.</p>
            )
          ) : (
            <p className={cn("mt-1", MUTED)}>Not loaded yet.</p>
          )}
        </ECard>
        <ECard className="min-w-0 p-4 text-[0.8125rem]">
          <h2 className="text-[0.9375rem] font-semibold">Property page</h2>
          <p className="mt-1">Each property keeps its Deep-clean planning section (Care and planning tab): baseline, due date, the same Choose date and Verify. Both read the same plan, so a date chosen in one shows in the other.</p>
        </ECard>
      </div>

      <EPhoneActionBar label="Deep-clean actions" primary={refreshButton} hidden={Boolean(selectedRow)} />
    </div>
  );
}
