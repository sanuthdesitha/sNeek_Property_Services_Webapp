"use client";

/**
 * ESTATE v2 — QA DAY PLANNER (admin / ops only).
 *
 * One column per inspector for a chosen day, listing their assignments in visit
 * order. Up/down arrows persist the order immediately via
 *   PATCH /api/admin/qa/assignments/reorder  { inspectorId, date, orderedAssignmentIds }
 * and the time input sets the planned slot via
 *   PATCH /api/admin/qa/assignments/[id]     { scheduledFor }
 *
 * The list is read from GET /api/qa/queue?inspectorId=…&date=… which already
 * returns rows ordered by sequence → scheduledFor → dueAt.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";

type Inspector = { id: string; name: string | null; email: string; role: string };

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "HH:mm" on `date` → an ISO instant in the browser's (Sydney ops) timezone. */
function toIsoAt(date: string, time: string): string | null {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function timeValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function InspectorColumn({
  inspector,
  date,
  onError,
}: {
  inspector: Inspector;
  date: string;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ inspectorId: inspector.id, date, assignedOnly: "0" });
    const res = await fetch(`/api/qa/queue?${qs.toString()}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      onError(body.error ?? "Could not load this inspector's day.");
      return;
    }
    setRows(body.assignments ?? []);
  }, [inspector.id, date, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function persistOrder(ordered: any[]) {
    setBusy(true);
    const res = await fetch("/api/admin/qa/assignments/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectorId: inspector.id,
        date,
        orderedAssignmentIds: ordered.map((r) => r.id),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onError(body.error ?? "Could not save the visit order.");
      await load();
      return;
    }
    setRows(ordered.map((r, i) => ({ ...r, sequence: i + 1 })));
  }

  function move(index: number, delta: number) {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next.map((r, i) => ({ ...r, sequence: i + 1 })));
    void persistOrder(next);
  }

  async function setSlot(assignmentId: string, time: string) {
    const iso = time ? toIsoAt(date, time) : null;
    setBusy(true);
    const res = await fetch(`/api/admin/qa/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledFor: iso }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onError(body.error ?? "Could not save the scheduled time.");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === assignmentId ? { ...r, scheduledFor: iso } : r)));
  }

  return (
    <ECard>
      <ECardHeader>
        <div className="flex items-center justify-between gap-2">
          <ECardTitle className="truncate">{inspector.name || inspector.email}</ECardTitle>
          <EBadge tone="neutral" soft>
            {rows.length} stop{rows.length === 1 ? "" : "s"}
          </EBadge>
        </div>
      </ECardHeader>
      <ECardBody className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nothing assigned for this day.</p>
        ) : (
          rows.map((row, index) => (
            <div
              key={row.id}
              className="flex items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-gold))] text-[0.75rem] font-bold text-[hsl(var(--e-gold-foreground))]">
                {row.sequence ?? index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] font-medium">{row.job?.property?.name ?? "Property"}</p>
                <p className="truncate text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                  {[row.job?.property?.suburb, row.job?.status].filter(Boolean).join(" · ")}
                </p>
              </div>
              <EInput
                type="time"
                className="h-8 w-[6.5rem]"
                value={timeValue(row.scheduledFor)}
                onChange={(e) => void setSlot(row.id, e.target.value)}
                aria-label="Scheduled inspection time"
              />
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                  className="rounded p-0.5 disabled:opacity-30"
                  aria-label="Move earlier"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy || index === rows.length - 1}
                  onClick={() => move(index, 1)}
                  className="rounded p-0.5 disabled:opacity-30"
                  aria-label="Move later"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </ECardBody>
    </ECard>
  );
}

export function QaDayPlanner({ inspectors }: { inspectors: Inspector[] }) {
  const [date, setDate] = useState<string>(() => todayIso());
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  if (inspectors.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="e-eyebrow">Day planner</p>
          <h2 className="text-[1.125rem] font-semibold">Inspector visit order</h2>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
          <EInput
            type="date"
            className="h-9 w-[10.5rem]"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Planner date"
          />
          <EButton variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </EButton>
        </div>
      </div>
      {error ? (
        <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem]">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {inspectors.map((inspector) => (
          <InspectorColumn
            key={`${inspector.id}-${date}-${nonce}`}
            inspector={inspector}
            date={date}
            onError={setError}
          />
        ))}
      </div>
    </section>
  );
}
