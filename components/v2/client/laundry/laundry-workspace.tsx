"use client";

/**
 * Estate laundry workspace (client) — read-only laundry schedule + timeline.
 * Data is server-fetched (listClientLaundryForUser) and passed as props, exactly
 * like the legacy ClientLaundryWorkspace. No endpoints called from the client.
 * Styled purely with `--e-*` tokens. No v1 UI imports (own inline media grid).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
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
import { buildLaundryConfirmationMediaItems, getLaundryConfirmationLabel } from "@/lib/laundry/media";
import { cn } from "@/lib/utils";

const TZ = "Australia/Sydney";
const COMPLETED_LAUNDRY_STATUSES = new Set(["DROPPED_OFF", "COMPLETED"]);
type FilterMode = "day" | "week" | "month";

function toLocalDate(value: string | Date) {
  return toZonedTime(new Date(value), TZ);
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
  if (mode === "day") return { start: startOfDay(anchor), end: endOfDay(anchor) };
  if (mode === "week") return { start: startOfWeek(anchor, { weekStartsOn: 1 }), end: endOfWeek(anchor, { weekStartsOn: 1 }) };
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
}
function formatLaundryStatus(task: any) {
  return String(task.status ?? "").replace(/_/g, " ");
}
function statusTone(task: any): "success" | "gold" | "neutral" {
  if (isCompletedTask(task)) return "success";
  if (task.status === "PICKED_UP" || task.status === "IN_PROGRESS") return "gold";
  return "neutral";
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
  if (latest) {
    return {
      title: latest.laundryReady ? "Cleaner marked laundry ready" : "Laundry update recorded",
      detail: [format(new Date(latest.createdAt), "dd MMM yyyy HH:mm"), latest.bagLocation || null].filter(Boolean).join(" • "),
    };
  }
  if (task.droppedAt) return { title: "Laundry returned", detail: format(toLocalDate(task.droppedAt), "dd MMM yyyy") };
  if (task.pickedUpAt) return { title: "Laundry picked up", detail: format(toLocalDate(task.pickedUpAt), "dd MMM yyyy") };
  return { title: "Laundry schedule created", detail: `Pickup ${format(toLocalDate(task.pickupDate), "dd MMM yyyy")}` };
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
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

export function LaundryWorkspace({ tasks, showLaundryImages }: { tasks: any[]; showLaundryImages: boolean }) {
  const searchParams = useSearchParams();
  const linkedTaskId = searchParams.get("task");
  const linkedJobId = searchParams.get("job");
  const today = useMemo(() => todayLocal(), []);
  const [filterMode, setFilterMode] = useState<FilterMode>("week");
  const [anchorDate, setAnchorDate] = useState(defaultDayKey());
  const taskRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const linkedTargetInitialized = useRef(false);

  const todayPriorityTasks = useMemo(
    () => [...tasks].filter((t) => isTodayCleaningLinked(t, today)).sort((l, r) => compareLaundryTasks(l, r, today)),
    [tasks, today]
  );

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

  const filteredTasks = useMemo(() => {
    const range = getFilterRange(filterMode, anchorDate);
    return tasks.filter((t) => touchesRange(t, range.start, range.end)).sort((l, r) => compareLaundryTasks(l, r, today));
  }, [anchorDate, filterMode, tasks, today]);

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
          "scroll-mt-24 rounded-[var(--e-radius-lg)] border bg-[hsl(var(--e-surface))] p-5",
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
              <p className="truncate font-[550] text-[hsl(var(--e-foreground))]">
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

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ["Cleaning date", format(toLocalDate(task.job.scheduledDate), "EEE dd MMM yyyy")],
            ["Pickup", format(toLocalDate(task.pickupDate), "EEE dd MMM yyyy")],
            ["Drop off", format(toLocalDate(task.dropoffDate), "EEE dd MMM yyyy")],
            ["Property", task.property.suburb],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">{label}</p>
              <p className="mt-0.5 font-[550]">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
          <EEyebrow>Latest update</EEyebrow>
          <p className="mt-1 font-[550]">{summary.title}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{summary.detail}</p>
        </div>

        <div className="mt-3 space-y-2">
          {Array.isArray(task.confirmations) && task.confirmations.length > 0 ? (
            task.confirmations.map((confirmation: any) => (
              <div key={confirmation.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
                <p className="font-[550]">{format(new Date(confirmation.createdAt), "dd MMM yyyy HH:mm")}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {getLaundryConfirmationLabel(confirmation)}
                  {confirmation.bagLocation ? ` • ${confirmation.bagLocation}` : ""}
                </p>
              </div>
            ))
          ) : (
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No laundry confirmations recorded yet.</p>
          )}
        </div>

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
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {confirmationPhotos.map((item: any, i: number) => (
              <a
                key={item.id ?? item.url ?? i}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt="" className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        ) : null}
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
              <p className="e-numeral e-tnum mt-1 text-[1.5rem] leading-none">{value}</p>
            </ECardBody>
          </ECard>
        ))}
      </section>

      {/* Filters */}
      <ECard>
        <ECardBody className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={filterMode === "day"} label="Day" onClick={() => setFilterMode("day")} />
            <FilterChip active={filterMode === "week"} label="Week" onClick={() => setFilterMode("week")} />
            <FilterChip active={filterMode === "month"} label="Month" onClick={() => setFilterMode("month")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-1.5 text-[0.8125rem]">
              <span className="text-[hsl(var(--e-muted-foreground))]">Anchor date</span>
              <EInput
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value || defaultDayKey())}
                className="h-auto border-0 bg-transparent px-0 focus:ring-0"
              />
            </div>
            <EButton variant="outline" size="sm" onClick={() => setAnchorDate(defaultDayKey())}>
              Reset to today
            </EButton>
          </div>
        </ECardBody>
      </ECard>

      {/* Today priority */}
      <div className="space-y-4">
        <div>
          <p className="text-[0.875rem] font-[550]">Today&apos;s cleaning-linked laundry schedules</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Always kept at the top so you can check today&apos;s live laundry follow-up first.
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
            {filterMode === "day" ? "Selected day" : filterMode === "week" ? "Selected week" : "Selected month"} schedule
          </p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Filtered by cleaning, pickup, or drop-off date around {format(parseDayKey(anchorDate), "dd MMM yyyy")}.
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
    </div>
  );
}
