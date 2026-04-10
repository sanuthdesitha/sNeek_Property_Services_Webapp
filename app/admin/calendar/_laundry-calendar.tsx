"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DatesSetArg, EventClickArg, EventContentArg } from "@fullcalendar/core";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MapPin,
  RefreshCw,
  Shirt,
  Sparkles,
} from "lucide-react";

const SYDNEY_TZ = "Australia/Sydney";

const STATUS_META: Record<
  string,
  { color: string; soft: string; badge: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"; label: string }
> = {
  PENDING: { color: "#64748b", soft: "rgba(100,116,139,0.14)", badge: "outline", label: "Pending" },
  CONFIRMED: { color: "#2563eb", soft: "rgba(37,99,235,0.14)", badge: "secondary", label: "Confirmed" },
  PICKED_UP: { color: "#0f766e", soft: "rgba(15,118,110,0.14)", badge: "default", label: "Picked up" },
  DROPPED: { color: "#16a34a", soft: "rgba(22,163,74,0.14)", badge: "success", label: "Completed" },
  FLAGGED: { color: "#dc2626", soft: "rgba(220,38,38,0.14)", badge: "destructive", label: "Flagged" },
  SKIPPED_PICKUP: { color: "#d97706", soft: "rgba(217,119,6,0.16)", badge: "warning", label: "Skipped pickup" },
};

type LaundryCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  classNames: string[];
  extendedProps: {
    status: string;
    suburb: string;
    clientName: string;
    pickupDate: string;
    dropoffDate: string;
    flagReason: string | null;
  };
};

function isoDate(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

function addOneDayIso(value: string | Date) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function getSydneyDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value?: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function getEventTextPalette(backgroundColor?: string | null) {
  const value = (backgroundColor ?? "").replace(/\s+/g, "").toLowerCase();
  const isLightRgba = value.startsWith("rgba(") || value.startsWith("hsla(");

  if (isLightRgba || !value) {
    return {
      primary: "text-slate-900",
      secondary: "text-slate-600",
      tertiary: "text-slate-500",
      dotClass: "bg-current",
      dotStyle: undefined as CSSProperties | undefined,
      pillClass: "bg-white/90 text-slate-700",
    };
  }

  return {
    primary: "text-white",
    secondary: "text-white/80",
    tertiary: "text-white/70",
    dotClass: "bg-white/85",
    dotStyle: undefined as CSSProperties | undefined,
    pillClass: "bg-white/20 text-white",
  };
}

export default function LaundryCalendarView() {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [events, setEvents] = useState<LaundryCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dayGridMonth");
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [boardExpanded, setBoardExpanded] = useState(false);

  async function loadRange(start: string, end: string) {
    setLoading(true);
    const params = new URLSearchParams({ start, end });
    const res = await fetch(`/api/admin/laundry/calendar?${params.toString()}`, { cache: "no-store" });
    const data = await res.json().catch(() => []);
    const nextEvents = Array.isArray(data)
      ? data.map((task: any) => {
          const meta = STATUS_META[String(task.status)] ?? STATUS_META.PENDING;
          return {
            id: task.id,
            title: task?.property?.name ?? "Laundry task",
            start: isoDate(task.pickupDate),
            end: addOneDayIso(task.dropoffDate),
            allDay: true,
            backgroundColor: meta.soft,
            borderColor: meta.color,
            textColor: "#0f172a",
            classNames: ["sneek-calendar-event", `status-${String(task.status).toLowerCase()}`],
            extendedProps: {
              status: String(task.status),
              suburb: String(task?.property?.suburb ?? ""),
              clientName: String(task?.property?.client?.name ?? ""),
              pickupDate: isoDate(task.pickupDate),
              dropoffDate: isoDate(task.dropoffDate),
              flagReason: task?.flagReason ?? null,
            },
          } satisfies LaundryCalendarEvent;
        })
      : [];
    setEvents(nextEvents);
    setLoading(false);
  }

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    void loadRange(api.view.activeStart.toISOString(), api.view.activeEnd.toISOString());
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const syncViewport = () => setIsCompactViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  const counts = useMemo(
    () =>
      events.reduce<Record<string, number>>((acc, event) => {
        const status = event.extendedProps.status;
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      }, {}),
    [events]
  );

  const todayIso = useMemo(() => getSydneyDateIso(), []);

  const summary = useMemo(
    () => [
      {
        label: "Tasks in range",
        value: events.length,
        icon: CalendarClock,
        note: "All pickups and drop-offs inside the current range.",
        accent: "from-sky-500/10 via-cyan-500/10 to-transparent",
      },
      {
        label: "Awaiting action",
        value: (counts.PENDING ?? 0) + (counts.CONFIRMED ?? 0),
        icon: Shirt,
        note: "Pending and confirmed tasks still in motion.",
        accent: "from-teal-500/10 via-emerald-500/10 to-transparent",
      },
      {
        label: "Completed",
        value: counts.DROPPED ?? 0,
        icon: CheckCircle2,
        note: "Returned and completed tasks visible in this range.",
        accent: "from-emerald-500/10 via-lime-500/10 to-transparent",
      },
      {
        label: "Exceptions",
        value: (counts.FLAGGED ?? 0) + (counts.SKIPPED_PICKUP ?? 0),
        icon: AlertTriangle,
        note: "Flagged items and skipped pickups to review.",
        accent: "from-amber-500/10 via-rose-500/10 to-transparent",
      },
    ],
    [counts, events.length]
  );

  const todaySpotlight = useMemo(() => {
    const activeToday = events.filter((event) => event.start <= todayIso && event.end > todayIso);
    const pickupToday = activeToday.filter((event) => event.extendedProps.pickupDate === todayIso);
    const dropoffToday = activeToday.filter((event) => event.extendedProps.dropoffDate === todayIso);
    const exceptionsToday = activeToday.filter((event) =>
      ["FLAGGED", "SKIPPED_PICKUP"].includes(event.extendedProps.status)
    );
    const nextPickup = [...events]
      .filter((event) => event.extendedProps.pickupDate >= todayIso)
      .sort((a, b) => a.extendedProps.pickupDate.localeCompare(b.extendedProps.pickupDate))[0];
    const nextDropoff = [...events]
      .filter((event) => event.extendedProps.dropoffDate >= todayIso)
      .sort((a, b) => a.extendedProps.dropoffDate.localeCompare(b.extendedProps.dropoffDate))[0];
    return {
      activeToday,
      pickupToday,
      dropoffToday,
      exceptionsToday,
      nextPickup,
      nextDropoff,
    };
  }, [events, todayIso]);

  function handleDatesSet(arg: DatesSetArg) {
    setView(arg.view.type);
    void loadRange(arg.start.toISOString(), arg.end.toISOString());
  }

  function handleEventClick(arg: EventClickArg) {
    router.push(`/admin/laundry?taskId=${arg.event.id}`);
  }

  function renderEventContent(arg: EventContentArg) {
    const status = String(arg.event.extendedProps.status ?? "");
    const meta = STATUS_META[status] ?? STATUS_META.PENDING;
    const suburb = String(arg.event.extendedProps.suburb ?? "");
    const clientName = String(arg.event.extendedProps.clientName ?? "");
    const pickupDate = String(arg.event.extendedProps.pickupDate ?? "");
    const dropoffDate = String(arg.event.extendedProps.dropoffDate ?? "");
    const flagReason = String(arg.event.extendedProps.flagReason ?? "");
    const palette = getEventTextPalette(arg.event.backgroundColor);
    const isMonthView = arg.view.type === "dayGridMonth";

    if (isMonthView) {
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${palette.dotClass}`}
              style={palette.dotClass === "bg-current" ? { backgroundColor: meta.color } : palette.dotStyle}
            />
            <span className={`truncate text-[10px] font-semibold uppercase tracking-[0.08em] ${palette.secondary}`}>
              {meta.label}
            </span>
            {flagReason ? (
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${palette.pillClass}`}>
                Issue
              </span>
            ) : null}
          </div>
          <span className={`truncate text-[11px] font-semibold ${palette.primary}`}>{arg.event.title}</span>
          <span className={`truncate text-[10px] ${palette.tertiary}`}>
            {clientName || suburb || "Laundry schedule"}
          </span>
        </div>
      );
    }

    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className={`truncate text-[11px] font-semibold uppercase tracking-[0.12em] ${palette.secondary}`}>
            {meta.label}
          </span>
        </div>
        <div className={`truncate text-xs font-semibold sm:text-[13px] ${palette.primary}`}>{arg.event.title}</div>
        <div className={`truncate text-[11px] ${palette.secondary}`}>
          {clientName || "Laundry schedule"}
          {suburb ? ` | ${suburb}` : ""}
        </div>
        <div className={`truncate text-[11px] ${palette.tertiary}`}>
          Pickup {pickupDate}
          {dropoffDate ? ` | Drop-off ${dropoffDate}` : ""}
        </div>
        {flagReason ? (
          <div className={`truncate text-[11px] ${palette.tertiary}`}>Issue: {flagReason.replace(/_/g, " ")}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="laundry-admin-calendar space-y-5 p-4 sm:p-5">
      <Card className="overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_32%),radial-gradient(circle_at_top_right,rgba(37,99,235,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))]">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="border-primary/15 bg-primary/10 text-primary">
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Laundry command view
                </Badge>
                <Badge variant="outline" className="border-border/70 bg-white/75">
                  {boardExpanded ? "Expanded" : "Collapsed"}
                </Badge>
              </div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Schedule Board
              </p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                Laundry briefing and schedule context
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Keep this collapsed for a cleaner calendar view, then expand it when you need the full pickup and return briefing.
              </p>
            </div>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setBoardExpanded((value) => !value)}>
              {boardExpanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
              {boardExpanded ? "Hide schedule board" : "Show schedule board"}
            </Button>
          </div>
          {boardExpanded ? (
          <div className="grid gap-0 border-t border-border/60 xl:grid-cols-[1.08fr_0.92fr]">
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-border/70 bg-white/75">
                  {view === "dayGridMonth" ? "Month view" : view === "dayGridWeek" ? "Week view" : "Day view"}
                </Badge>
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Schedule Board
              </p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Laundry pickups and returns with real operational context
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Keep pickups, returns, flagged items, and today&apos;s workload in one calendar so the laundry team can
                see what matters first and operations can jump into the full task detail immediately.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  type="button"
                  className="rounded-full px-5"
                  onClick={() => {
                    const api = calendarRef.current?.getApi();
                    if (!api) return;
                    void loadRange(api.view.activeStart.toISOString(), api.view.activeEnd.toISOString());
                  }}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Refresh range
                </Button>
                <div className="inline-flex items-center rounded-full border border-border/70 bg-white/80 px-4 py-2 text-sm text-muted-foreground">
                  <CalendarRange className="mr-2 h-4 w-4 text-primary" />
                  Click any task to open the full laundry detail
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summary.map((item) => (
                  <div
                    key={item.label}
                    className={`rounded-2xl border border-white/70 bg-gradient-to-br ${item.accent} p-3 shadow-sm backdrop-blur`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 shadow-sm">
                        <item.icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{item.label}</p>
                        <p className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.note}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border/60 bg-slate-950/[0.03] p-5 sm:p-6 xl:border-l xl:border-t-0">
              <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Today spotlight
                    </p>
                    <h4 className="mt-2 text-xl font-semibold">What needs attention first</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Snapshot for {formatDateLabel(todayIso)} in Sydney time.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-primary/10 p-3">
                    <Shirt className="h-5 w-5 text-primary" />
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border/60 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Active today</p>
                    <p className="mt-1 text-xl font-semibold">{todaySpotlight.activeToday.length}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Pickup today</p>
                    <p className="mt-1 text-xl font-semibold">{todaySpotlight.pickupToday.length}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Exceptions today</p>
                    <p className="mt-1 text-xl font-semibold">{todaySpotlight.exceptionsToday.length}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-xl bg-sky-100 p-2 text-sky-700">
                        <CalendarClock className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Next pickup</p>
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {todaySpotlight.nextPickup?.title ?? "No upcoming pickup in this range"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {todaySpotlight.nextPickup
                            ? `${formatDateLabel(todaySpotlight.nextPickup.extendedProps.pickupDate)}${todaySpotlight.nextPickup.extendedProps.clientName ? ` | ${todaySpotlight.nextPickup.extendedProps.clientName}` : ""}`
                            : "Adjust the range or refresh to load more"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-xl bg-emerald-100 p-2 text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Next drop-off</p>
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {todaySpotlight.nextDropoff?.title ?? "No upcoming drop-off in this range"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {todaySpotlight.nextDropoff
                            ? `${formatDateLabel(todaySpotlight.nextDropoff.extendedProps.dropoffDate)}${todaySpotlight.nextDropoff.extendedProps.suburb ? ` | ${todaySpotlight.nextDropoff.extendedProps.suburb}` : ""}`
                            : "Completed tasks stay visible in the timeline"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-dashed border-border/70 bg-slate-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Status legend
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(STATUS_META).map(([status, meta]) => (
                      <Badge key={status} variant={meta.badge}>
                        {meta.label} ({counts[status] ?? 0})
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.3fr]">
        <div className="relative overflow-visible rounded-[calc(var(--radius)+10px)] border border-white/70 bg-white/80 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="border-b border-border/60 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.78))] px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Calendar canvas</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Month, week, and day views share the same theme as dispatch and keep laundry exceptions visible.
                </p>
              </div>
              <Badge variant="outline" className="border-border/70 bg-white/80">
                {events.length} tasks loaded
              </Badge>
            </div>
          </div>
          <div className="relative">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "dayGridMonth,dayGridWeek,dayGridDay",
              }}
              buttonText={{
                today: "Today",
                month: "Month",
                week: "Week",
                day: "Day",
              }}
              height="auto"
              events={events}
              eventContent={renderEventContent}
              datesSet={handleDatesSet}
              eventClick={handleEventClick}
              stickyHeaderDates
              dayMaxEventRows={4}
              moreLinkClick="popover"
              fixedWeekCount={false}
              eventOrder="start,-duration,title"
              weekNumbers
              nowIndicator
              timeZone="Australia/Sydney"
              eventTimeFormat={
                isCompactViewport
                  ? { month: "short", day: "numeric" }
                  : { month: "short", day: "numeric" }
              }
              eventDidMount={(info) => {
                const details = info.event.extendedProps as LaundryCalendarEvent["extendedProps"];
                info.el.setAttribute(
                  "title",
                  `${info.event.title}${details.clientName ? ` | ${details.clientName}` : ""}${details.suburb ? ` | ${details.suburb}` : ""}`
                );
              }}
            />
          </div>
        </div>

        <Card className="border-primary/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.9))]">
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quick context</p>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/10 p-2 text-primary">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Open task detail from any event</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Click a pickup or return card to jump directly to the full laundry task with confirmations, photos,
                      and related notes.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Exceptions stay visible</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Flagged tasks and skipped pickups are highlighted so operations can spot interruptions without
                      opening each day.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Today stays the anchor</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Use the spotlight panel to keep the current day grounded even when the calendar range spans a full
                      month.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <style jsx global>{`
        .laundry-admin-calendar .fc {
          position: relative;
          z-index: 0;
          --fc-border-color: rgba(148, 163, 184, 0.22);
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: rgba(248, 250, 252, 0.72);
          --fc-today-bg-color: rgba(37, 99, 235, 0.06);
          --fc-button-bg-color: #0f766e;
          --fc-button-border-color: #0f766e;
          --fc-button-text-color: #f8fafc;
          --fc-button-hover-bg-color: #115e59;
          --fc-button-hover-border-color: #115e59;
          --fc-button-active-bg-color: #134e4a;
          --fc-button-active-border-color: #134e4a;
          --fc-button-active-text-color: #ffffff;
        }

        .laundry-admin-calendar .fc .fc-toolbar.fc-header-toolbar {
          margin-bottom: 1rem;
          padding: 1rem 1rem 0.25rem;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .laundry-admin-calendar .fc .fc-toolbar-title {
          font-size: 1.1rem;
          font-weight: 700;
          color: #0f172a;
        }

        .laundry-admin-calendar .fc .fc-button {
          border-radius: 9999px;
          box-shadow: 0 10px 24px -18px rgba(15, 23, 42, 0.55);
          font-weight: 600;
          padding: 0.45rem 0.85rem;
          color: #f8fafc;
        }

        .laundry-admin-calendar .fc .fc-scrollgrid,
        .laundry-admin-calendar .fc .fc-col-header-cell,
        .laundry-admin-calendar .fc .fc-daygrid-day {
          border-color: rgba(148, 163, 184, 0.22);
        }

        .laundry-admin-calendar .fc .fc-col-header-cell-cushion,
        .laundry-admin-calendar .fc .fc-daygrid-day-number {
          color: #334155;
          font-weight: 600;
          padding: 0.55rem 0.35rem;
        }

        .laundry-admin-calendar .fc .fc-day-today .fc-daygrid-day-number {
          color: #2563eb;
        }

        .laundry-admin-calendar .fc .fc-day-today {
          box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.12);
          background: linear-gradient(180deg, rgba(37, 99, 235, 0.04), rgba(255, 255, 255, 0));
        }

        .laundry-admin-calendar .fc .fc-day-other {
          background: rgba(248, 250, 252, 0.65);
        }

        .laundry-admin-calendar .fc .fc-week-number {
          display: inline-flex;
          min-width: 1.7rem;
          height: 1.7rem;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          background: rgba(15, 118, 110, 0.08);
          color: #0f766e;
          font-size: 0.7rem;
          font-weight: 700;
        }

        .laundry-admin-calendar .fc .sneek-calendar-event {
          border-width: 1px;
          border-radius: 16px;
          padding: 0.38rem 0.45rem;
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.35),
            0 14px 30px -26px rgba(15, 23, 42, 0.65);
          transition: transform 160ms ease, box-shadow 160ms ease;
        }

        .laundry-admin-calendar .fc .sneek-calendar-event:hover {
          transform: translateY(-1px);
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.4),
            0 20px 36px -26px rgba(15, 23, 42, 0.75);
        }

        .laundry-admin-calendar .fc .fc-daygrid-event-harness {
          margin-top: 0.22rem;
        }

        .laundry-admin-calendar .fc .fc-daygrid-event {
          min-height: 1.6rem;
        }

        .laundry-admin-calendar .fc .fc-daygrid-day-events {
          margin: 0 0.2rem 0.25rem;
        }

        .laundry-admin-calendar .fc .fc-daygrid-more-link {
          margin: 0.18rem 0.3rem 0.25rem;
          font-size: 0.72rem;
          font-weight: 600;
          color: #2563eb;
        }

        .laundry-admin-calendar .fc .fc-daygrid-more-link:hover {
          color: #1d4ed8;
        }

        .laundry-admin-calendar .fc .fc-event-main {
          padding: 0;
        }

        .laundry-admin-calendar .fc .fc-popover {
          z-index: 40;
          background: #ffffff;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.24);
          opacity: 1;
          overflow: hidden;
          box-shadow: 0 20px 45px rgba(15, 23, 42, 0.18);
        }

        .laundry-admin-calendar .fc .fc-popover-header {
          padding: 0.7rem 0.9rem;
          background: #f8fafc;
        }

        .laundry-admin-calendar .fc .fc-popover-title,
        .laundry-admin-calendar .fc .fc-popover-close {
          color: #0f172a;
        }

        .laundry-admin-calendar .fc .fc-more-popover .fc-popover-body {
          background: #ffffff;
          padding: 0.45rem 0.55rem 0.65rem;
        }

        .laundry-admin-calendar .fc .fc-more-popover .fc-daygrid-event-harness,
        .laundry-admin-calendar .fc .fc-more-popover .fc-daygrid-event-harness-abs {
          position: relative !important;
          inset: auto !important;
          display: block !important;
          margin-top: 0.28rem !important;
        }

        .laundry-admin-calendar .fc .fc-more-popover .fc-daygrid-event {
          margin: 0 !important;
        }

        .laundry-admin-calendar .fc .fc-view-harness,
        .laundry-admin-calendar .fc .fc-view-harness-active {
          overflow: visible;
        }

        .laundry-admin-calendar .fc .fc-scrollgrid {
          border-radius: calc(var(--radius) + 6px);
          overflow: hidden;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9));
        }

        .laundry-admin-calendar .fc .fc-daygrid-day-frame {
          min-height: 7rem;
        }

        @media (max-width: 768px) {
          .laundry-admin-calendar .fc .fc-toolbar.fc-header-toolbar {
            padding: 0.85rem 0.85rem 0;
          }

          .laundry-admin-calendar .fc .fc-toolbar-title {
            font-size: 0.95rem;
          }

          .laundry-admin-calendar .fc .fc-button {
            padding: 0.4rem 0.65rem;
            font-size: 0.75rem;
          }

          .laundry-admin-calendar .fc .fc-toolbar-chunk {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
          }

          .laundry-admin-calendar .fc .fc-daygrid-day-events {
            margin-inline: 0.1rem;
          }

          .laundry-admin-calendar .fc .fc-daygrid-more-link {
            margin-inline: 0.18rem;
          }

          .laundry-admin-calendar .fc .fc-daygrid-day-frame {
            min-height: 5.6rem;
          }
        }
      `}</style>
    </div>
  );
}
