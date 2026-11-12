"use client";

/**
 * QA Today: the day's visit order (approved board "QA portal", screen 1).
 *
 * Reads the inspector's own day from `GET /api/qa/queue?date=…` (the same
 * contract the queue uses) and shows each stop with its readiness. A clean
 * still in progress says "Wait" and offers Monitor clean; starting early asks
 * for a reason first ("Start anyway"). Moving a stop earlier or later writes
 * through the existing day-planner endpoint, which only the office may call,
 * so the arrows appear only for administrators and operations managers.
 *
 * Obsolete reads are discarded (request sequence + abort) so a late answer for
 * another day never fills this one.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { EAlert, EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import type { QaPaySettingsInput } from "@/lib/finance/qa-pay";
import {
  buildVisitOrderRows,
  moveVisit,
  nextVisit,
  type QueueAssignmentInput,
  type VisitOrderRow,
} from "@/lib/qa/visit-order-view";
import { EarlyStartDialog, requestQaPickup } from "@/components/v2/qa/today/early-start-dialog";

type DayMode = "today" | "tomorrow" | "custom";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: VisitOrderRow[]; dateKey: string };

export interface QaVisitOrderProps {
  viewerId: string;
  /** ADMIN / OPS_MANAGER: may reorder through the day-planner endpoint. */
  canReorder: boolean;
  qaPaySettings: QaPaySettingsInput | null;
  /** Today's Sydney date key (YYYY-MM-DD), from the server. */
  todayKey: string;
}

const CHIP =
  "inline-flex min-h-11 items-center rounded-[var(--e-radius-pill)] border px-4 text-[0.8125rem] font-[550] focus-visible:outline focus-visible:outline-2";

export function QaVisitOrder({ viewerId, canReorder, qaPaySettings, todayKey }: QaVisitOrderProps) {
  const router = useRouter();
  const [mode, setMode] = React.useState<DayMode>("today");
  const [customDate, setCustomDate] = React.useState(todayKey);
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [saving, setSaving] = React.useState(false);
  const [moveError, setMoveError] = React.useState<string | null>(null);
  const [earlyStart, setEarlyStart] = React.useState<{ row: VisitOrderRow; message: string } | null>(null);
  const [startError, setStartError] = React.useState<string | null>(null);
  const sequence = React.useRef(0);
  const dateParam = mode === "custom" ? customDate : mode;

  const load = React.useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current;
    setState({ kind: "loading" });
    try {
      const qs = new URLSearchParams({ scope: "active", date: dateParam });
      // The office may widen the queue; the visit order is always their own day.
      if (canReorder) qs.set("assignedOnly", "1");
      const res = await fetch(`/api/qa/queue?${qs.toString()}`, { cache: "no-store", signal });
      const body: { assignments?: QueueAssignmentInput[]; error?: string } = await res.json().catch(() => ({}));
      if (request !== sequence.current || signal?.aborted) return;
      if (!res.ok || !Array.isArray(body.assignments)) {
        setState({ kind: "error", message: body.error ?? "Could not load your visit order." });
        return;
      }
      setState({ kind: "ready", rows: buildVisitOrderRows(body.assignments, qaPaySettings), dateKey: dateParam });
    } catch (error) {
      if (request !== sequence.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setState({ kind: "error", message: "Could not load your visit order. Check your connection and retry." });
    }
  }, [dateParam, qaPaySettings, canReorder]);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function move(index: number, delta: -1 | 1) {
    if (state.kind !== "ready" || saving) return;
    const reordered = moveVisit(state.rows, index, delta);
    if (!reordered) return;
    const previous = state.rows;
    setMoveError(null);
    setSaving(true);
    setState({ ...state, rows: reordered });
    try {
      const res = await fetch("/api/admin/qa/assignments/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspectorId: viewerId,
          date: state.dateKey,
          orderedAssignmentIds: reordered.map((row) => row.assignmentId),
        }),
      });
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}));
        setState({ ...state, rows: previous });
        setMoveError(body.error ?? "Could not save the visit order. Nothing changed.");
      }
    } catch {
      setState({ ...state, rows: previous });
      setMoveError("Could not save the visit order while offline. Nothing changed.");
    } finally {
      setSaving(false);
    }
  }

  async function startAnyway(row: VisitOrderRow) {
    setStartError(null);
    const result = await requestQaPickup(row.jobId);
    if (result.kind === "started") router.push(`/v2/qa/jobs/${row.jobId}`);
    else if (result.kind === "reason-required") setEarlyStart({ row, message: result.message });
    else setStartError(result.message);
  }

  const rows = state.kind === "ready" ? state.rows : [];
  const next = nextVisit(rows);
  // Only the viewer's own stops can be moved: the endpoint orders one inspector's day.
  const movable = canReorder && rows.length > 1 && rows.every((row) => row.assignedToId === viewerId);

  return (
    <section aria-labelledby="qa-visit-order" className="space-y-3">
      <div role="group" aria-label="Day" className="flex flex-wrap items-center gap-2">
        {(["today", "tomorrow"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={`${CHIP} ${mode === value ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))]"}`}
          >
            {value === "today" ? "Today" : "Tomorrow"}
          </button>
        ))}
        <label className="flex items-center gap-2 text-[0.8125rem] font-[550] text-[hsl(var(--e-muted-foreground))]">
          Pick a date
          <EInput
            type="date"
            className="h-11 w-[10.5rem]"
            value={customDate}
            onChange={(event) => {
              setCustomDate(event.target.value);
              if (event.target.value) setMode("custom");
            }}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        <h2 id="qa-visit-order" className="e-eyebrow">Visit order</h2>
        <EButton variant="ghost" size="sm" onClick={() => void load()} disabled={state.kind === "loading"}>
          <RefreshCw className={state.kind === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden /> Refresh
        </EButton>
      </div>

      {state.kind === "loading" ? (
        <p role="status" className="flex items-center gap-2 py-6 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your visit order…
        </p>
      ) : state.kind === "error" ? (
        <div role="alert">
          <EAlert tone="danger" title="Visit order unavailable">
            {state.message}{" "}
            <button type="button" className="font-[550] underline" onClick={() => void load()}>Retry</button>
          </EAlert>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          No inspections planned for this day. Work you can pick up is under All inspections below.
        </p>
      ) : (
        <ol className="divide-y divide-[hsl(var(--e-border))] overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          {rows.map((row, index) => (
            <li key={row.assignmentId} className="flex items-center gap-3 px-3 py-2.5">
              <span aria-hidden className="e-tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-muted))] text-[0.8125rem] font-[600]">
                {row.position}
              </span>
              <Link href={`/v2/qa/jobs/${row.jobId}`} className="min-w-0 flex-1 py-1 focus-visible:outline focus-visible:outline-2">
                <span className="sr-only">Stop {row.position}: </span>
                <span className="block truncate text-[0.9375rem] font-[600]">{row.property}</span>
                <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
                  {row.detail} · {row.pay}
                </span>
              </Link>
              <EBadge tone={row.readiness.tone} soft>{row.readiness.label}</EBadge>
              {movable ? (
                <span className="flex shrink-0 flex-col">
                  <button type="button" disabled={saving || index === 0} onClick={() => void move(index, -1)}
                    aria-label={`Move ${row.property} earlier`}
                    className="flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2">
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" disabled={saving || index === rows.length - 1} onClick={() => void move(index, 1)}
                    aria-label={`Move ${row.property} later`}
                    className="flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2">
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {state.kind === "ready" && rows.length > 0 && !canReorder ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">The office sets the visit order. Ask them to move a stop earlier or later.</p>
      ) : null}
      {moveError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{moveError}</p> : null}
      {saving ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Saving the visit order…</p> : null}

      {next ? (
        <>
          <ECard>
            <ECardBody className="p-0">
              <Link href={`/v2/qa/jobs/${next.jobId}#know-before-you-go`}
                className="flex min-h-12 items-center gap-3 px-4 py-3 focus-visible:outline focus-visible:outline-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] font-[600]">Know before you go · {next.property}</span>
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Last QA, client requests, open cases and timing for this stop
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
              </Link>
            </ECardBody>
          </ECard>
          {startError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{startError}</p> : null}
          {next.waitingForCleaner ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <EButton asChild variant="outline" size="lg">
                <Link href={`/v2/qa/jobs/${next.jobId}`}>Monitor clean</Link>
              </EButton>
              <EButton variant="gold" size="lg" onClick={() => void startAnyway(next)}>Start anyway</EButton>
            </div>
          ) : (
            <EButton asChild variant="gold" size="lg" className="w-full">
              <Link href={`/v2/qa/jobs/${next.jobId}`}>
                {next.stage === "INSPECTING" ? "Continue inspection" : "Start inspection"} · {next.property}
              </Link>
            </EButton>
          )}
        </>
      ) : null}

      <EarlyStartDialog
        open={earlyStart !== null}
        jobId={earlyStart?.row.jobId ?? ""}
        propertyName={earlyStart?.row.property ?? "this inspection"}
        message={earlyStart?.message ?? ""}
        onCancel={() => setEarlyStart(null)}
        onStarted={() => {
          const jobId = earlyStart?.row.jobId;
          setEarlyStart(null);
          if (jobId) router.push(`/v2/qa/jobs/${jobId}`);
        }}
      />
    </section>
  );
}
