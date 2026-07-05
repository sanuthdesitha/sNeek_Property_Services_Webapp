"use client";

/**
 * Native Estate laundry calendar — a month grid + agenda of laundry pickups and
 * drop-offs, reading the SAME feed the laundry board uses:
 *   GET /api/laundry/week?start=<iso>&days=<n>   → BoardTask[]
 *
 * Each LaundryTask yields two calendar entries (a pickup and a return),
 * coloured by the real LaundryStatus. Clicking an entry deep-links to the
 * relevant task on the tracking board (`/v2/laundry/tracking#task-<id>`).
 *
 * Zero FullCalendar / v1 imports — only the v2 Estate kit + lucide + `--e-*`.
 */
import * as React from "react";
import Link from "next/link";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Package, RefreshCw, Truck } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import type { BoardTask, LaundryStatus } from "@/components/v2/laundry/laundry-board";
import { STATUS_LABEL, STATUS_TONE } from "@/components/v2/laundry/laundry-board";

/* ── Calendar entry model ──────────────────────────────────────────────── */
type Kind = "pickup" | "dropoff";
type Entry = {
  key: string;
  taskId: string;
  kind: Kind;
  date: Date;
  status: LaundryStatus;
  property: string;
  suburb?: string | null;
};

function propertyName(t: BoardTask): string {
  return t.property?.name ?? "Property";
}

function buildEntries(tasks: BoardTask[]): Entry[] {
  const out: Entry[] = [];
  for (const t of tasks) {
    const property = propertyName(t);
    const suburb = t.property?.suburb ?? null;
    if (t.pickupDate) {
      out.push({
        key: `${t.id}-pickup`,
        taskId: t.id,
        kind: "pickup",
        date: new Date(t.pickupDate),
        status: t.status,
        property,
        suburb,
      });
    }
    if (t.dropoffDate) {
      out.push({
        key: `${t.id}-dropoff`,
        taskId: t.id,
        kind: "dropoff",
        date: new Date(t.dropoffDate),
        status: t.status,
        property,
        suburb,
      });
    }
  }
  return out;
}

/* Status → the Estate token used for the entry's accent bar / dot. */
const STATUS_COLOR: Record<LaundryStatus, string> = {
  PENDING: "hsl(var(--e-muted-foreground))",
  CONFIRMED: "hsl(var(--e-primary))",
  PICKED_UP: "hsl(var(--e-info))",
  DROPPED: "hsl(var(--e-success))",
  FLAGGED: "hsl(var(--e-danger))",
  SKIPPED_PICKUP: "hsl(var(--e-warning))",
};

function taskHref(taskId: string) {
  return `/v2/laundry/tracking#task-${taskId}`;
}

/* ── Data hook: fetch a window covering the visible month ───────────────── */
function useCalendarFeed(monthAnchor: Date) {
  const [tasks, setTasks] = React.useState<BoardTask[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      // Cover the whole visible grid (prev/next month spill) with margin.
      const start = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 1 });
      const end = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 1 });
      const days = Math.max(1, Math.round((+end - +start) / 86_400_000) + 1);
      const res = await fetch(`/api/laundry/week?start=${start.toISOString()}&days=${days}`, {
        cache: "no-store",
      });
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [monthAnchor]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return { tasks, loading, load };
}

export function LaundryCalendar() {
  const [monthAnchor, setMonthAnchor] = React.useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = React.useState<Date>(() => new Date());
  const { tasks, loading, load } = useCalendarFeed(monthAnchor);

  const entries = React.useMemo(() => buildEntries(tasks), [tasks]);

  const entriesByDay = React.useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = format(e.date, "yyyy-MM-dd");
      const list = map.get(k) ?? [];
      list.push(e);
      map.set(k, list);
    }
    for (const list of Array.from(map.values())) list.sort((a: Entry, b: Entry) => +a.date - +b.date);
    return map;
  }, [entries]);

  const gridDays = React.useMemo(() => {
    const start = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [monthAnchor]);

  const selectedEntries = entriesByDay.get(format(selected, "yyyy-MM-dd")) ?? [];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <EButton
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonthAnchor((m) => startOfMonth(addMonths(m, -1)))}
          >
            <ChevronLeft className="h-4 w-4" />
          </EButton>
          <p className="e-display-sm min-w-[10rem] text-center">{format(monthAnchor, "MMMM yyyy")}</p>
          <EButton
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonthAnchor((m) => startOfMonth(addMonths(m, 1)))}
          >
            <ChevronRight className="h-4 w-4" />
          </EButton>
          <EButton
            variant="ghost"
            size="sm"
            onClick={() => {
              const now = new Date();
              setMonthAnchor(startOfMonth(now));
              setSelected(now);
            }}
          >
            Today
          </EButton>
        </div>
        <EButton variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </EButton>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {(Object.keys(STATUS_LABEL) as LaundryStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Month grid */}
        <ECard>
          <ECardBody className="pt-6">
            <div className="grid grid-cols-7 gap-px">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div
                  key={d}
                  className="pb-2 text-center text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]"
                >
                  {d}
                </div>
              ))}
              {gridDays.map((day) => {
                const dayEntries = entriesByDay.get(format(day, "yyyy-MM-dd")) ?? [];
                const inMonth = isSameMonth(day, monthAnchor);
                const isSel = isSameDay(day, selected);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setSelected(day)}
                    className="flex min-h-[4.75rem] flex-col gap-1 rounded-[var(--e-radius-sm)] border p-1.5 text-left transition-colors duration-[120ms]"
                    style={{
                      borderColor: isSel ? "hsl(var(--e-gold))" : "hsl(var(--e-border))",
                      backgroundColor: isSel
                        ? "hsl(var(--e-gold-soft))"
                        : inMonth
                          ? "hsl(var(--e-surface))"
                          : "hsl(var(--e-surface-sunken))",
                      opacity: inMonth ? 1 : 0.55,
                    }}
                  >
                    <span
                      className="e-tnum text-[0.75rem] font-[550]"
                      style={{
                        color: isToday(day) ? "hsl(var(--e-gold-ink))" : "hsl(var(--e-foreground))",
                      }}
                    >
                      {format(day, "d")}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      {dayEntries.slice(0, 3).map((e) => (
                        <span
                          key={e.key}
                          className="flex items-center gap-1 truncate rounded-[var(--e-radius-xs)] px-1 py-0.5 text-[0.625rem] leading-tight"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${STATUS_COLOR[e.status]} 16%, transparent)`,
                            color: "hsl(var(--e-foreground))",
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: STATUS_COLOR[e.status] }}
                          />
                          <span className="truncate">{e.property}</span>
                        </span>
                      ))}
                      {dayEntries.length > 3 ? (
                        <span className="px-1 text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">
                          +{dayEntries.length - 3} more
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </ECardBody>
        </ECard>

        {/* Agenda for the selected day */}
        <ECard>
          <ECardBody className="space-y-3 pt-6">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
              <p className="text-[0.9375rem] font-[550]">{format(selected, "EEEE d MMM")}</p>
            </div>
            {selectedEntries.length === 0 ? (
              <EEmptyState
                eyebrow="Clear"
                title="Nothing scheduled"
                description="No laundry pickups or returns on this day."
              />
            ) : (
              <div className="space-y-2">
                {selectedEntries.map((e) => (
                  <Link
                    key={e.key}
                    href={taskHref(e.taskId)}
                    className="flex items-start gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 transition-colors duration-[120ms] hover:border-[hsl(var(--e-border-gold)/0.5)]"
                  >
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `color-mix(in srgb, ${STATUS_COLOR[e.status]} 18%, transparent)` }}
                    >
                      {e.kind === "pickup" ? (
                        <Truck className="h-3.5 w-3.5" style={{ color: STATUS_COLOR[e.status] }} />
                      ) : (
                        <Package className="h-3.5 w-3.5" style={{ color: STATUS_COLOR[e.status] }} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-[550]">{e.property}</p>
                      <p className="mt-0.5 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        <span>{e.kind === "pickup" ? "Pickup" : "Return"} · {format(e.date, "HH:mm")}</span>
                        {e.suburb ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {e.suburb}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <EBadge tone={STATUS_TONE[e.status]} soft>
                      {STATUS_LABEL[e.status]}
                    </EBadge>
                  </Link>
                ))}
              </div>
            )}
          </ECardBody>
        </ECard>
      </div>
    </div>
  );
}
