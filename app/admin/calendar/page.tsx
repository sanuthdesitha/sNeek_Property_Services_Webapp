"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Calendar, CalendarDays, Shirt } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

const CALENDAR_TAB_STORAGE_KEY = "sneek_admin_calendar_default_tab_v1";

// FullCalendar is client-only
const FullCalendarComponent = dynamic(() => import("./_calendar"), { ssr: false, loading: () => <p className="p-8 text-muted-foreground">Loading calendar…</p> });
const LaundryCalendarComponent = dynamic(() => import("./_laundry-calendar"), { ssr: false, loading: () => <p className="p-8 text-muted-foreground">Loading laundry calendar…</p> });

const CALENDAR_TABS = [
  { value: "jobs" as const, label: "Jobs", icon: CalendarDays },
  { value: "laundry" as const, label: "Laundry", icon: Shirt },
];

export default function CalendarPage() {
  const [activeCalendarTab, setActiveCalendarTab] = useState<"jobs" | "laundry">("jobs");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CALENDAR_TAB_STORAGE_KEY);
      if (saved === "jobs" || saved === "laundry") {
        setActiveCalendarTab(saved);
      }
    } catch {
      // Ignore storage failures.
    }
  }, []);

  function selectTab(tab: "jobs" | "laundry") {
    setActiveCalendarTab(tab);
    try {
      window.localStorage.setItem(CALENDAR_TAB_STORAGE_KEY, tab);
    } catch {
      // Ignore storage failures.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          icon={<Calendar />}
          title="Dispatch Calendar"
          description="Scheduled jobs and laundry pickups in one place — spot clashes early and open any job from its card."
        />
        <div className="inline-flex w-full shrink-0 rounded-full border border-border bg-surface p-0.5 sm:w-auto">
          {CALENDAR_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeCalendarTab === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => selectTab(tab.value)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeCalendarTab === "jobs" ? <FullCalendarComponent /> : <LaundryCalendarComponent />}
    </div>
  );
}
