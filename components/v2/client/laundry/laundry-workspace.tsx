"use client";

/**
 * Estate laundry workspace (client) — read-only laundry schedule + timeline.
 * Initial data is server-scoped; filter changes use the same authorized laundry API.
 * Styled purely with `--e-*` tokens. No v1 UI imports (own inline media grid).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MediaGallery } from "@/components/shared/media-gallery";
import {
  addDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ArrowLeft, Shirt } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import { buildLaundryConfirmationMediaItems, getLaundryConfirmationLabel, describeLaundryConfirmation } from "@/lib/laundry/media";
import { cn } from "@/lib/utils";

const TZ = "Australia/Sydney";
// Terminal states from the client's view, using the real LaundryStatus enum
// (PENDING/CONFIRMED/PICKED_UP/DROPPED/FLAGGED/SKIPPED_PICKUP). The old set used
// "DROPPED_OFF"/"COMPLETED" — values that never exist — so a returned/skipped
// bag never showed as done and stayed out of sync with what admin/cleaner sent.
const COMPLETED_LAUNDRY_STATUSES = new Set(["DROPPED", "SKIPPED_PICKUP"]);
// "all" exists and is the DEFAULT because the page previously opened on a
// week window anchored to today: a client whose laundry fell outside the
// current week landed on two empty cards and reasonably read the page as
// broken. The page must always show the client's laundry until they narrow it.
type FilterMode = "all" | "day" | "week" | "month" | "custom";

function toLocalDate(value: string | Date) {
  return toZonedTime(new Date(value), TZ);
}
function displayDate(value: string | Date | null | undefined) {
  return value && !Number.isNaN(new Date(value).getTime()) ? format(toLocalDate(value), "EEE dd MMM yyyy") : "Not scheduled";
}
function dayKey(value: string | Date) {
  return format(toLocalDate(value), "yyyy-MM-dd");
}
function todayLocal() {
  return toZonedTime(new Date(), TZ);
}
function defaultDayKey() {
  return format(todayLocal(), "yyyy-MM-dd");
}
function parseDayKey(value: string) {
  const [year, month, day] = value.split("-").map((p) => Number(p));
  if (!year || !month || !day) return startOfDay(todayLocal());
  return new Date(year, month - 1, day);
}
function getRelevantDates(task: any) {
  return [task.job?.scheduledDate, task.pickupDate, task.dropoffDate].filter(Boolean).map((v) => toLocalDate(v));
}
function touchesRange(task: any, start: Date, end: Date) {
  return getRelevantDates(task).some((v) => isWithinInterval(v, { start, end }));
}
function isTodayCleaningLinked(task: any, today: Date) {
  return Boolean(task.job?.scheduledDate) && isSameDay(toLocalDate(task.job.scheduledDate), today);
}
function touchesToday(task: any, today: Date) {
  return touchesRange(task, startOfDay(today), endOfDay(today));
}
function isCompletedTask(task: any) {
  return COMPLETED_LAUNDRY_STATUSES.has(String(task.status ?? ""));
}
function getUpcomingMoment(task: any, todayStart: Date) {
  const dates = getRelevantDates(task).sort((l, r) => l.getTime() - r.getTime());
  return dates.find((v) => v.getTime() >= todayStart.getTime()) ?? dates[0] ?? toLocalDate(task.updatedAt);
}
function getCompletedMoment(task: any) {
  const dates = [...getRelevantDates(task), toLocalDate(task.updatedAt)].sort((l, r) => r.getTime() - l.getTime());
  return dates[0] ?? toLocalDate(task.updatedAt);
}
function compareLaundryTasks(left: any, right: any, today: Date) {
  const todayStart = startOfDay(today);
  const rank = (t: any) =>
    isTodayCleaningLinked(t, today) ? 0 : touchesToday(t, today) ? 1 : isCompletedTask(t) ? 3 : 2;
  const l = rank(left);
  const r = rank(right);
  if (l !== r) return l - r;
  if (l === 3) return getCompletedMoment(right).getTime() - getCompletedMoment(left).getTime();
  return getUpcomingMoment(left, todayStart).getTime() - getUpcomingMoment(right, todayStart).getTime();
}
function getFilterRange(mode: FilterMode, anchorDate: string) {
  const anchor = parseDayKey(anchorDate);
  if (mode === "all") return null;
  if (mode === "day") return { start: startOfDay(anchor), end: endOfDay(anchor) };
  if (mode === "week") return { start: startOfWeek(anchor, { weekStartsOn: 1 }), end: endOfWeek(anchor, { weekStartsOn: 1 }) };
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
}
// Friendly labels for the real LaundryStatus enum — CONFIRMED and PICKED_UP
// must read (and colour) differently so the client can tell "we've scheduled
// it" apart from "the linen has left the property". Mirrors the admin helper
// in components/v2/admin/laundry/laundry-shared.ts.
const LAUNDRY_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PICKED_UP: "Picked up",
  DROPPED: "Delivered",
  FLAGGED: "Flagged",
  SKIPPED_PICKUP: "Skipped",
};
function formatLaundryStatus(task: any) {
  const status = String(task.status ?? "");
  return LAUNDRY_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}
function statusTone(task: any): "success" | "gold" | "info" | "warning" | "danger" | "neutral" {
  switch (String(task.status ?? "")) {
    case "DROPPED":
      return "success";
    // Scheduled with the laundry team, but the linen hasn't moved yet.
    case "CONFIRMED":
      return "info";
    // Collected and in transit — the gold "in flight" state.
    case "PICKED_UP":
      return "gold";
    case "FLAGGED":
      return "danger";
    case "SKIPPED_PICKUP":
      return "warning";
    default:
      return "neutral";
  }
}
function buildLatestLaundrySummary(task: any) {
  const latest = Array.isArray(task.confirmations) ? task.confirmations[0] : null;
  if (task.adminOverrideNote) return { title: "Admin update", detail: task.adminOverrideNote };
  if (task.status === "SKIPPED_PICKUP" || task.noPickupRequired) {
    const reason = task.skipReasonCode ? String(task.skipReasonCode).replace(/_/g, " ") : "No pickup required";
    return {
      title: task.noPickupRequired ? "Pickup skipped" : "Pickup update",
      detail: task.skipReasonNote ? `${reason} • ${task.skipReasonNote}` : reason,
    };
  }
  // Movement milestones outrank the raw confirmation feed: once the linen has
  // been delivered or collected, the headline must say so — not the earlier
  // "cleaner marked ready" confirmation-era wording.
  if (task.status === "DROPPED" || task.droppedAt) {
    return {
      title: "Laundry delivered",
      detail: task.droppedAt ? format(toLocalDate(task.droppedAt), "dd MMM yyyy") : "Delivered back to the property",
    };
  }
  if (task.status === "PICKED_UP" || task.pickedUpAt) {
    return {
      title: "Laundry picked up",
      detail: task.pickedUpAt ? format(toLocalDate(task.pickedUpAt), "dd MMM yyyy") : "Collected by the laundry team",
    };
  }
  if (latest) {
    return {
      title: latest.laundryReady ? "Cleaner marked laundry ready" : "Laundry update recorded",
      detail: [format(new Date(latest.createdAt), "dd MMM yyyy HH:mm"), latest.bagLocation || null].filter(Boolean).join(" • "),
    };
  }
  return { title: "Laundry schedule created", detail: `Pickup ${format(toLocalDate(task.pickupDate), "dd MMM yyyy")}` };
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-[var(--e-radius-pill)] border px-4 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms]",
        active
          ? "border-[hsl(var(--e-accent-portal))] bg-[hsl(var(--e-accent-portal))] text-[hsl(var(--e-accent-portal-foreground))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]"
      )}
    >
      {label}
    </button>
  );
}

export function LaundryWorkspace({ tasks, showLaundryImages, properties: availableProperties = [] }: { tasks: any[]; showLaundryImages: boolean; properties?: { id: string; name: string }[] }) {
  const searchParams = useSearchParams();
  const linkedTaskId = searchParams.get("task");
  const linkedJobId = searchParams.get("job");
  const today = useMemo(() => todayLocal(), []);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [anchorDate, setAnchorDate] = useState(defaultDayKey());
  const [endDate, setEndDate] = useState(defaultDayKey());
  const [propertyId, setPropertyId] = useState("");
  const [status, setStatus] = useState("");
  const [dateField, setDateField] = useState("any");
  const [compact, setCompact] = useState(true);
  const [rows, setRows] = useState(tasks);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const properties = useMemo(() => Array.from(new Map([...tasks.map(task => task.property), ...rows.map(task => task.property), ...availableProperties].map(property => [property.id, property])).values()).sort((a, b) => a.name.localeCompare(b.name)), [tasks, rows, availableProperties]);
  const invalidRange = filterMode === "custom" && endDate < anchorDate;
  useEffect(() => {
    if (invalidRange) { setRows([]); setError("End date must be on or after start date."); setLoading(false); return; }
    const controller = new AbortController(); let cancelled = false;
    const params = new URLSearchParams();
    if (propertyId) params.set("propertyId", propertyId);
    if (status) params.set("status", status);
    params.set("dateField", dateField);
    const range = filterMode === "custom" ? { start: parseDayKey(anchorDate), end: parseDayKey(endDate) } : getFilterRange(filterMode, anchorDate);
    if (range) { params.set("from", format(range.start, "yyyy-MM-dd")); params.set("to", format(range.end, "yyyy-MM-dd")); }
    setLoading(true); setError("");
    fetch('/api/client/laundry?' + params, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok || !Array.isArray(data)) throw new Error("Could not load laundry. Please retry.");
      if (!cancelled) setRows(data);
    }).catch(() => { if (!cancelled) { setRows([]); setError("Could not load laundry. Please retry."); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [anchorDate, endDate, filterMode, propertyId, status, dateField, retry, invalidRange]);
  const taskRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const linkedTargetInitialized = useRef(false);

  useEffect(() => {
    if (linkedTargetInitialized.current) return;
    if (!linkedTaskId && !linkedJobId) {
      linkedTargetInitialized.current = true;
      return;
    }
    const target = tasks.find((t) => t.id === linkedTaskId) ?? tasks.find((t) => t.job?.id === linkedJobId) ?? null;
    linkedTargetInitialized.current = true;
    if (!target) return;
    setFilterMode("month");
    setAnchorDate(dayKey(target.pickupDate));
  }, [linkedJobId, linkedTaskId, tasks]);

  const filteredTasks = useMemo(() => [...rows].sort((l, r) => compareLaundryTasks(l, r, today)), [rows, today]);
  const todayPriorityTasks = useMemo(() => filteredTasks.filter(t => isTodayCleaningLinked(t, today)), [filteredTasks, today]);

  const visibleFilteredTasks = useMemo(() => {
    const ids = new Set(todayPriorityTasks.map((t) => t.id));
    return filteredTasks.filter((t) => !ids.has(t.id));
  }, [filteredTasks, todayPriorityTasks]);

  useEffect(() => {
    const targetId =
      linkedTaskId && taskRefs.current[linkedTaskId]
        ? linkedTaskId
        : linkedJobId
          ? tasks.find((t) => t.job?.id === linkedJobId)?.id
          : null;
    if (!targetId) return;
    const node = taskRefs.current[targetId];
    if (!node) return;
    const frame = window.requestAnimationFrame(() => node.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [filteredTasks, linkedJobId, linkedTaskId, tasks, todayPriorityTasks]);

  const completedCount = useMemo(() => filteredTasks.filter((t) => isCompletedTask(t)).length, [filteredTasks]);

  function renderTaskCard(task: any, options?: { highlight?: boolean; showContextLabel?: boolean }) {
    const summary = buildLatestLaundrySummary(task);
    const confirmationPhotos = buildLaundryConfirmationMediaItems(task.confirmations);

    return (
      <div
        key={task.id}
        ref={(node) => {
          taskRefs.current[task.id] = node;
        }}
        className={cn(
          "min-w-0 break-words scroll-mt-24 rounded-[var(--e-radius-lg)] border bg-[hsl(var(--e-surface))] ",
          compact ? "p-3" : "p-5",
          options?.highlight
            ? "border-[hsl(var(--e-border-gold)/0.6)] shadow-[var(--e-elevation-gold)]"
            : "border-[hsl(var(--e-border))]"
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
              <Shirt className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="break-words font-[550] text-[hsl(var(--e-foreground))]">
                {task.property.name} ·{" "}
                {task.job.jobNumber ? `Job ${task.job.jobNumber}` : String(task.job.jobType).replace(/_/g, " ")}
              </p>
              {options?.showContextLabel ? (
                <p className="mt-0.5 text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))]">
                  Today&apos;s cleaning-linked laundry schedule
                </p>
              ) : null}
            </div>
          </div>
          <EBadge tone={statusTone(task)} soft>
            {formatLaundryStatus(task)}
          </EBadge>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Cleaning date", displayDate(task.job?.scheduledDate)],
            ["Pickup", displayDate(task.pickupDate)],
            ["Drop off", displayDate(task.dropoffDate)],
            ["Property", task.property.suburb],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">{label}</p>
              <p className="mt-0.5 font-[550]">{value}</p>
            </div>
          ))}
        </div>

        <details key={compact ? "compact" : "expanded"} open={compact ? undefined : true} className="mt-3">
        <summary className="cursor-pointer py-2 text-sm font-medium">Updates, notes and photos</summary>
        <div className="mt-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
          <EEyebrow>Latest update</EEyebrow>
          <p className="mt-1 font-[550]">{summary.title}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{summary.detail}</p>
        </div>

        {/* Brief by default: the "Latest update" box above already says what
            happened, so the full confirmation feed stays folded away and is
            opened only when someone actually wants the history. */}
        {Array.isArray(task.confirmations) && task.confirmations.length > 0 ? (
          <details className="mt-3 group">
            <summary className="cursor-pointer select-none list-none text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline">
              {task.confirmations.length} update{task.confirmations.length === 1 ? "" : "s"} · show details
            </summary>
            <div className="mt-2 space-y-2">
              {task.confirmations.map((confirmation: any) => (
                <div
                  key={confirmation.id}
                  className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3"
                >
                  <p className="font-[550]">{format(toLocalDate(confirmation.createdAt), "dd MMM yyyy HH:mm")}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {getLaundryConfirmationLabel(confirmation)}
                    {confirmation.bagLocation ? ` • ${confirmation.bagLocation}` : ""}
                  </p>
                  {describeLaundryConfirmation(confirmation) ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{describeLaundryConfirmation(confirmation)}</p> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {task.skipReasonCode ? (
          <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Reason: {String(task.skipReasonCode).replace(/_/g, " ")}
          </p>
        ) : null}
        {task.skipReasonNote ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{task.skipReasonNote}</p>
        ) : null}
        {task.adminOverrideNote ? (
          <p className="mt-2 text-[0.75rem] font-[550] text-[hsl(var(--e-warning))]">Admin note: {task.adminOverrideNote}</p>
        ) : null}

        {showLaundryImages && confirmationPhotos.length > 0 ? (
          <div className="mt-3">
            <MediaGallery
              items={confirmationPhotos.map((item: any, i: number) => ({
                id: item.id ?? item.url ?? String(i),
                url: item.url,
                label: item.label ?? undefined,
                mediaType: item.mediaType,
              }))}
              title="Laundry confirmation"
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
            />
          </div>
        ) : null}
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back to jobs */}
      <div>
        <Link
          href="/v2/client/jobs"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))] hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to jobs
        </Link>
      </div>

      {/* Summary */}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Today's linked cleans", todayPriorityTasks.length],
          ["Matching this filter", filteredTasks.length],
          ["Completed in range", completedCount],
        ].map(([label, value]) => (
          <ECard key={String(label)}>
            <ECardBody className="p-4">
              <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">{label}</p>
              <p className="e-numeral e-tnum mt-1 text-[1.5rem] leading-none">{loading || error ? "—" : value}</p>
            </ECardBody>
          </ECard>
        ))}
      </section>

      {/* Filters */}
      <ECard>
        <ECardBody className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={compact} label="Compact view" onClick={() => setCompact(value => !value)} />
            <FilterChip active={filterMode === "custom"} label="Custom dates" onClick={() => setFilterMode("custom")} />
            <FilterChip active={filterMode === "all"} label="All" onClick={() => setFilterMode("all")} />
            <FilterChip active={filterMode === "day"} label="Day" onClick={() => setFilterMode("day")} />
            <FilterChip active={filterMode === "week"} label="Week" onClick={() => setFilterMode("week")} />
            <FilterChip active={filterMode === "month"} label="Month" onClick={() => setFilterMode("month")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="min-w-0 text-sm">Property<select aria-label="Property" value={propertyId} onChange={e => setPropertyId(e.target.value)} className="mt-1 w-full rounded border bg-transparent p-2"><option value="">All properties</option>{properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
            <label className="min-w-0 text-sm">Status<select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} className="mt-1 w-full rounded border bg-transparent p-2"><option value="">All statuses</option>{Object.entries(LAUNDRY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="min-w-0 text-sm">Filter dates by<select aria-label="Filter dates by" value={dateField} onChange={e => setDateField(e.target.value)} className="mt-1 w-full rounded border bg-transparent p-2"><option value="any">Any laundry or cleaning date</option><option value="cleaning">Cleaning date</option><option value="pickup">Pickup date</option><option value="dropoff">Drop-off date</option></select></label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-1.5 text-[0.8125rem]">
              <span className="text-[hsl(var(--e-muted-foreground))]">{filterMode === "custom" ? "Start date" : "Date"}</span>
              <EInput
                aria-label="Start date"
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value || defaultDayKey())}
                className="h-auto border-0 bg-transparent px-0 focus:ring-0"
              />
            </div>
            {filterMode === "custom" ? <label className="min-w-0 text-sm">End date<EInput aria-label="End date" type="date" value={endDate} min={anchorDate} onChange={e => setEndDate(e.target.value || anchorDate)} className="max-w-full" /></label> : null}
            <EButton variant="outline" size="sm" onClick={() => { setFilterMode("day"); setAnchorDate(format(addDays(parseDayKey(anchorDate), -1), "yyyy-MM-dd")); }}>Previous day</EButton>
            <EButton variant="outline" size="sm" onClick={() => { setFilterMode("day"); setAnchorDate(defaultDayKey()); }}>Today</EButton>
            <EButton variant="outline" size="sm" onClick={() => { setFilterMode("day"); setAnchorDate(format(addDays(parseDayKey(anchorDate), 1), "yyyy-MM-dd")); }}>Next day</EButton>
            <EButton variant="ghost" size="sm" onClick={() => { setFilterMode("all"); setPropertyId(""); setStatus(""); setDateField("any"); }}>Clear filters</EButton>
          </div>
        </ECardBody>
      </ECard>

      <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Dates use Sydney time. Showing up to 200 matching schedules; narrow the dates or property to see a smaller set. All dates uses the recent history window.</p>
      {loading ? <p role="status">Loading laundry schedules…</p> : null}
      {error ? <div role="alert">{error}{!invalidRange ? <EButton variant="outline" onClick={() => setRetry(value => value + 1)}>Retry</EButton> : null}</div> : null}
      {!loading && !error ? <>
      {/* Today priority */}
      <div className="space-y-4">
        <div>
          <p className="text-[0.875rem] font-[550]">Today&apos;s cleaning-linked laundry schedules</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Matching today&apos;s cleaning jobs, within your selected filters.
          </p>
        </div>
        {todayPriorityTasks.length > 0 ? (
          <div className="space-y-4">
            {todayPriorityTasks.map((task) =>
              renderTaskCard(task, { highlight: task.id === linkedTaskId || task.job?.id === linkedJobId, showContextLabel: true })
            )}
          </div>
        ) : (
          <ECard>
            <ECardBody className="p-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No laundry schedule is linked to today&apos;s cleaning jobs.
            </ECardBody>
          </ECard>
        )}
      </div>

      {/* Filtered range */}
      <div className="space-y-4">
        <div>
          <p className="text-[0.875rem] font-[550]">
            {filterMode === "all"
              ? "All laundry schedules"
              : `${filterMode === "day" ? "Selected day" : filterMode === "week" ? "Selected week" : filterMode === "custom" ? "Custom date" : "Selected month"} schedule`}
          </p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {filterMode === "all"
              ? "Recent laundry schedules matching your selected properties and statuses."
              : `${dateField === "any" ? "Cleaning, pickup or drop-off" : dateField === "cleaning" ? "Cleaning" : dateField === "pickup" ? "Pickup" : "Drop-off"} dates: ${format(parseDayKey(anchorDate), "dd MMM yyyy")}${filterMode === "custom" ? " to " + format(parseDayKey(endDate), "dd MMM yyyy") : " (" + filterMode + ")"}.`}
          </p>
        </div>
        {visibleFilteredTasks.length > 0 ? (
          <div className="space-y-4">
            {visibleFilteredTasks.map((task) =>
              renderTaskCard(task, { highlight: task.id === linkedTaskId || task.job?.id === linkedJobId })
            )}
          </div>
        ) : (
          <ECard>
            <ECardBody className="p-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No laundry schedule updates match the selected range.
            </ECardBody>
          </ECard>
        )}
      </div>
      </> : null}
    </div>
  );
}
