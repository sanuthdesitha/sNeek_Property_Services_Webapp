"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DatesSetArg, EventClickArg, EventContentArg } from "@fullcalendar/core";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Shirt } from "lucide-react";
import { useRouter } from "next/navigation";

const STATUS_META: Record<string, { color: string; soft: string; label: string }> = {
  PENDING: { color: "#64748b", soft: "rgba(100,116,139,0.14)", label: "Pending" },
  CONFIRMED: { color: "#2563eb", soft: "rgba(37,99,235,0.14)", label: "Confirmed" },
  PICKED_UP: { color: "#0f766e", soft: "rgba(15,118,110,0.14)", label: "Picked up" },
  DROPPED: { color: "#16a34a", soft: "rgba(22,163,74,0.14)", label: "Completed" },
  FLAGGED: { color: "#dc2626", soft: "rgba(220,38,38,0.14)", label: "Flagged" },
  SKIPPED_PICKUP: { color: "#d97706", soft: "rgba(217,119,6,0.16)", label: "Skipped pickup" },
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

export default function LaundryCalendarView() {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [events, setEvents] = useState<LaundryCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dayGridMonth");

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
    const currentView = api.view;
    void loadRange(currentView.activeStart.toISOString(), currentView.activeEnd.toISOString());
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
    const flagReason = String(arg.event.extendedProps.flagReason ?? "");
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600">
            {meta.label}
          </span>
        </div>
        <div className="truncate text-[11px] font-semibold text-slate-900 sm:text-[12px]">
          {arg.event.title}
        </div>
        <div className="truncate text-[10px] text-slate-600">
          {suburb || "Laundry schedule"}
          {flagReason ? ` • ${flagReason.replace(/_/g, " ")}` : ""}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tasks in view</p>
            <p className="mt-2 text-2xl font-semibold">{events.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pending / confirmed</p>
            <p className="mt-2 text-2xl font-semibold">{(counts.PENDING ?? 0) + (counts.CONFIRMED ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Picked up</p>
            <p className="mt-2 text-2xl font-semibold">{counts.PICKED_UP ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Exceptions</p>
            <p className="mt-2 text-2xl font-semibold">{(counts.FLAGGED ?? 0) + (counts.SKIPPED_PICKUP ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            <Shirt className="mr-1 h-3.5 w-3.5" />
            {view === "dayGridMonth" ? "Month view" : view === "timeGridWeek" ? "Week view" : "Day view"}
          </Badge>
          <Badge variant="outline">Click any task to open full laundry detail</Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const api = calendarRef.current?.getApi();
            if (!api) return;
            void loadRange(api.view.activeStart.toISOString(), api.view.activeEnd.toISOString());
          }}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay",
        }}
        height="auto"
        events={events}
        eventContent={renderEventContent}
        datesSet={handleDatesSet}
        eventClick={handleEventClick}
      />
    </div>
  );
}
