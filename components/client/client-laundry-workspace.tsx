"use client";

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
import { CalendarDays, ExternalLink, Shirt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MediaGallery } from "@/components/shared/media-gallery";
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
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return startOfDay(todayLocal());
  }
  return new Date(year, month - 1, day);
}

function getRelevantDates(task: any) {
  return [task.job?.scheduledDate, task.pickupDate, task.dropoffDate]
    .filter(Boolean)
    .map((value) => toLocalDate(value));
}

function touchesRange(task: any, start: Date, end: Date) {
  return getRelevantDates(task).some((value) => isWithinInterval(value, { start, end }));
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
  const relevantDates = getRelevantDates(task).sort((left, right) => left.getTime() - right.getTime());
  const firstUpcoming = relevantDates.find((value) => value.getTime() >= todayStart.getTime());
  return firstUpcoming ?? relevantDates[0] ?? toLocalDate(task.updatedAt);
}

function getCompletedMoment(task: any) {
  const relevantDates = [...getRelevantDates(task), toLocalDate(task.updatedAt)].sort(
    (left, right) => right.getTime() - left.getTime()
  );
  return relevantDates[0] ?? toLocalDate(task.updatedAt);
}

function compareLaundryTasks(left: any, right: any, today: Date) {
  const todayStart = startOfDay(today);
  const leftRank = isTodayCleaningLinked(left, today)
    ? 0
    : touchesToday(left, today)
      ? 1
      : isCompletedTask(left)
        ? 3
        : 2;
  const rightRank = isTodayCleaningLinked(right, today)
    ? 0
    : touchesToday(right, today)
      ? 1
      : isCompletedTask(right)
        ? 3
        : 2;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  if (leftRank === 3) {
    return getCompletedMoment(right).getTime() - getCompletedMoment(left).getTime();
  }

  return getUpcomingMoment(left, todayStart).getTime() - getUpcomingMoment(right, todayStart).getTime();
}

function getFilterRange(mode: FilterMode, anchorDate: string) {
  const anchor = parseDayKey(anchorDate);
  if (mode === "day") {
    return { start: startOfDay(anchor), end: endOfDay(anchor) };
  }
  if (mode === "week") {
    return {
      start: startOfWeek(anchor, { weekStartsOn: 1 }),
      end: endOfWeek(anchor, { weekStartsOn: 1 }),
    };
  }
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
}

function formatLaundryStatus(task: any) {
  return String(task.status ?? "").replace(/_/g, " ");
}

function buildLatestLaundrySummary(task: any) {
  const latestConfirmation = Array.isArray(task.confirmations) ? task.confirmations[0] : null;
  if (task.adminOverrideNote) {
    return {
      title: "Admin update",
      detail: task.adminOverrideNote,
    };
  }
  if (task.status === "SKIPPED_PICKUP" || task.noPickupRequired) {
    const reason = task.skipReasonCode ? String(task.skipReasonCode).replace(/_/g, " ") : "No pickup required";
    return {
      title: task.noPickupRequired ? "Pickup skipped" : "Pickup update",
      detail: task.skipReasonNote ? `${reason} • ${task.skipReasonNote}` : reason,
    };
  }
  if (latestConfirmation) {
    return {
      title: latestConfirmation.laundryReady ? "Cleaner marked laundry ready" : "Laundry update recorded",
      detail: [
        format(new Date(latestConfirmation.createdAt), "dd MMM yyyy HH:mm"),
        latestConfirmation.bagLocation || null,
      ]
        .filter(Boolean)
        .join(" • "),
    };
  }
  if (task.droppedAt) {
    return {
      title: "Laundry returned",
      detail: format(toLocalDate(task.droppedAt), "dd MMM yyyy"),
    };
  }
  if (task.pickedUpAt) {
    return {
      title: "Laundry picked up",
      detail: format(toLocalDate(task.pickedUpAt), "dd MMM yyyy"),
    };
  }
  return {
    title: "Laundry schedule created",
    detail: `Pickup ${format(toLocalDate(task.pickupDate), "dd MMM yyyy")}`,
  };
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant={active ? "default" : "outline"} className="rounded-full" onClick={onClick}>
      {label}
    </Button>
  );
}

export function ClientLaundryWorkspace({
  tasks,
  showLaundryImages,
}: {
  tasks: any[];
  showLaundryImages: boolean;
}) {
  const searchParams = useSearchParams();
  const linkedTaskId = searchParams.get("task");
  const linkedJobId = searchParams.get("job");
  const today = useMemo(() => todayLocal(), []);
  const [filterMode, setFilterMode] = useState<FilterMode>("week");
  const [anchorDate, setAnchorDate] = useState(defaultDayKey());
  const taskRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const linkedTargetInitialized = useRef(false);

  const todayPriorityTasks = useMemo(
    () =>
      [...tasks]
        .filter((task) => isTodayCleaningLinked(task, today))
        .sort((left, right) => compareLaundryTasks(left, right, today)),
    [tasks, today]
  );

  useEffect(() => {
    if (linkedTargetInitialized.current) {
      return;
    }
    if (!linkedTaskId && !linkedJobId) {
      linkedTargetInitialized.current = true;
      return;
    }
    const targetTask =
      tasks.find((task) => task.id === linkedTaskId) ??
      tasks.find((task) => task.job?.id === linkedJobId) ??
      null;
    if (!targetTask) {
      linkedTargetInitialized.current = true;
      return;
    }
    linkedTargetInitialized.current = true;
    setFilterMode("month");
    setAnchorDate(dayKey(targetTask.pickupDate));
  }, [linkedJobId, linkedTaskId, tasks]);

  const filteredTasks = useMemo(() => {
    const range = getFilterRange(filterMode, anchorDate);
    return tasks
      .filter((task) => touchesRange(task, range.start, range.end))
      .sort((left, right) => compareLaundryTasks(left, right, today));
  }, [anchorDate, filterMode, tasks, today]);

  const visibleFilteredTasks = useMemo(() => {
    const priorityIds = new Set(todayPriorityTasks.map((task) => task.id));
    return filteredTasks.filter((task) => !priorityIds.has(task.id));
  }, [filteredTasks, todayPriorityTasks]);

  useEffect(() => {
    const targetId =
      linkedTaskId && taskRefs.current[linkedTaskId]
        ? linkedTaskId
        : linkedJobId
          ? tasks.find((task) => task.job?.id === linkedJobId)?.id
          : null;
    if (!targetId) return;
    const node = taskRefs.current[targetId];
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [filteredTasks, linkedJobId, linkedTaskId, tasks, todayPriorityTasks]);

  const completedCount = useMemo(
    () => filteredTasks.filter((task) => isCompletedTask(task)).length,
    [filteredTasks]
  );

  function renderTaskCard(task: any, options?: { highlight?: boolean; showContextLabel?: boolean }) {
    const summary = buildLatestLaundrySummary(task);
    const confirmationPhotos = buildLaundryConfirmationMediaItems(task.confirmations);

    return (
      <Card
        key={task.id}
        ref={(node) => {
          taskRefs.current[task.id] = node;
        }}
        className={cn(
          "scroll-mt-24",
          options?.highlight && "border-primary/70 bg-primary/5 shadow-[0_0_0_1px_rgba(14,116,144,0.14)]"
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-start justify-between gap-3 text-base">
            <span className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                <Shirt className="h-4 w-4 text-primary" />
              </span>
              <span className="min-w-0">
                <span className="block truncate">
                  {task.property.name} •{" "}
                  {task.job.jobNumber ? `Job ${task.job.jobNumber}` : task.job.jobType.replace(/_/g, " ")}
                </span>
                {options?.showContextLabel ? (
                  <span className="mt-1 block text-xs font-normal text-primary">
                    Today&apos;s cleaning-linked laundry schedule
                  </span>
                ) : null}
              </span>
            </span>
            <span className="rounded-full border px-2 py-1 text-xs font-medium">{formatLaundryStatus(task)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Cleaning date</p>
              <p className="font-medium">{format(toLocalDate(task.job.scheduledDate), "EEE dd MMM yyyy")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pickup</p>
              <p className="font-medium">{format(toLocalDate(task.pickupDate), "EEE dd MMM yyyy")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Drop off</p>
              <p className="font-medium">{format(toLocalDate(task.dropoffDate), "EEE dd MMM yyyy")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Property</p>
              <p className="font-medium">{task.property.suburb}</p>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Latest update</p>
            <p className="mt-1 font-medium">{summary.title}</p>
            <p className="text-xs text-muted-foreground">{summary.detail}</p>
          </div>

          <div className="space-y-2">
            {task.confirmations.length > 0 ? (
              task.confirmations.map((confirmation: any) => (
                <div key={confirmation.id} className="rounded-lg border bg-background p-3">
                  <p className="font-medium">{format(new Date(confirmation.createdAt), "dd MMM yyyy HH:mm")}</p>
                  <p className="text-xs text-muted-foreground">
                    {getLaundryConfirmationLabel(confirmation)}
                    {confirmation.bagLocation ? ` • ${confirmation.bagLocation}` : ""}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No laundry confirmations recorded yet.</p>
            )}
          </div>

          {task.skipReasonCode ? (
            <p className="text-xs text-muted-foreground">Reason: {String(task.skipReasonCode).replace(/_/g, " ")}</p>
          ) : null}
          {task.skipReasonNote ? <p className="text-xs text-muted-foreground">{task.skipReasonNote}</p> : null}
          {task.adminOverrideNote ? (
            <p className="text-xs font-medium text-amber-700">Admin note: {task.adminOverrideNote}</p>
          ) : null}

          {showLaundryImages && confirmationPhotos.length > 0 ? (
            <MediaGallery
              items={confirmationPhotos}
              title={`${task.property.name} laundry images`}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
            />
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Laundry</h1>
          <p className="text-sm text-muted-foreground">
            Read-only laundry schedule and timeline for your properties, with today&apos;s linked cleaning jobs pinned first.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/client/jobs">
            <CalendarDays className="mr-2 h-4 w-4" />
            Back to jobs
          </Link>
        </Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Today&apos;s linked cleans</p>
            <p className="text-2xl font-bold">{todayPriorityTasks.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Matching this filter</p>
            <p className="text-2xl font-bold">{filteredTasks.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Completed in this range</p>
            <p className="text-2xl font-bold">{completedCount}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterButton active={filterMode === "day"} label="Day" onClick={() => setFilterMode("day")} />
            <FilterButton active={filterMode === "week"} label="Week" onClick={() => setFilterMode("week")} />
            <FilterButton active={filterMode === "month"} label="Month" onClick={() => setFilterMode("month")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-sm">
              <span className="text-muted-foreground">Anchor date</span>
              <Input
                type="date"
                value={anchorDate}
                onChange={(event) => setAnchorDate(event.target.value || defaultDayKey())}
                className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <Button variant="outline" onClick={() => setAnchorDate(defaultDayKey())}>
              Reset to today
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Today&apos;s cleaning-linked laundry schedules</p>
            <p className="text-xs text-muted-foreground">
              These are always kept at the top so the client can check today&apos;s live laundry follow-up first.
            </p>
          </div>
        </div>
        {todayPriorityTasks.length > 0 ? (
          <div className="space-y-4">
            {todayPriorityTasks.map((task) =>
              renderTaskCard(task, {
                highlight: task.id === linkedTaskId || task.job?.id === linkedJobId,
                showContextLabel: true,
              })
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No laundry schedule is linked to today&apos;s cleaning jobs.
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              {filterMode === "day" ? "Selected day" : filterMode === "week" ? "Selected week" : "Selected month"} schedule
            </p>
            <p className="text-xs text-muted-foreground">
              Filtered by cleaning date, pickup date, or drop-off date around {format(parseDayKey(anchorDate), "dd MMM yyyy")}.
            </p>
          </div>
          {linkedTaskId || linkedJobId ? (
            <Button variant="outline" asChild>
              <Link href="/client/jobs">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open jobs
              </Link>
            </Button>
          ) : null}
        </div>

        {visibleFilteredTasks.length > 0 ? (
          <div className="space-y-4">
            {visibleFilteredTasks.map((task) =>
              renderTaskCard(task, {
                highlight: task.id === linkedTaskId || task.job?.id === linkedJobId,
              })
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No laundry schedule updates match the selected range.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
