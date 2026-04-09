"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, LayoutGrid, Settings2, Shirt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CALENDAR_TAB_STORAGE_KEY = "sneek_admin_calendar_default_tab_v1";

// FullCalendar is client-only
const FullCalendarComponent = dynamic(() => import("./_calendar"), { ssr: false, loading: () => <p className="p-8 text-muted-foreground">Loading calendar…</p> });
const LaundryCalendarComponent = dynamic(() => import("./_laundry-calendar"), { ssr: false, loading: () => <p className="p-8 text-muted-foreground">Loading laundry calendar…</p> });

export default function CalendarPage() {
  const [activeCalendarTab, setActiveCalendarTab] = useState("jobs");
  const [tabOptionsOpen, setTabOptionsOpen] = useState(false);
  const [defaultCalendarTab, setDefaultCalendarTab] = useState<"jobs" | "laundry">("jobs");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CALENDAR_TAB_STORAGE_KEY);
      if (saved === "jobs" || saved === "laundry") {
        setActiveCalendarTab(saved);
        setDefaultCalendarTab(saved);
      }
    } catch {
      // Ignore storage failures.
    }
  }, []);

  function saveDefaultCalendarTab() {
    try {
      window.localStorage.setItem(CALENDAR_TAB_STORAGE_KEY, defaultCalendarTab);
      setActiveCalendarTab(defaultCalendarTab);
    } catch {
      // Ignore storage failures.
    }
    setTabOptionsOpen(false);
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-primary/20">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Calendar
              </p>
              <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Dispatch Calendar</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                Review all scheduled jobs and laundry pickups in one place, spot clashes early, and jump straight into a job from the calendar card.
              </p>
            </div>
            <div className="grid gap-3 border-t border-border/60 bg-muted/20 p-5 sm:grid-cols-2 sm:p-6 lg:border-l lg:border-t-0">
              <div className="rounded-2xl border border-border/70 bg-white/70 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                    <CalendarDays className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Best for</p>
                    <p className="text-sm font-semibold">Monthly workload scan</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-white/70 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                    <LayoutGrid className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Switch views</p>
                    <p className="text-sm font-semibold">Month, week, and day</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-white/70 p-4 sm:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Default open view</p>
                    <p className="text-sm font-semibold">
                      {defaultCalendarTab === "jobs" ? "Jobs calendar" : "Laundry schedule"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setTabOptionsOpen(true)}>
                    <Settings2 className="mr-2 h-4 w-4" />
                    Options
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeCalendarTab} onValueChange={setActiveCalendarTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="jobs" className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Jobs Calendar
          </TabsTrigger>
          <TabsTrigger value="laundry" className="flex items-center gap-2">
            <Shirt className="h-4 w-4" />
            Laundry Schedule
          </TabsTrigger>
        </TabsList>
        <TabsContent value="jobs" className="mt-4">
          <Card className="overflow-hidden">
            <FullCalendarComponent />
          </Card>
        </TabsContent>
        <TabsContent value="laundry" className="mt-4">
          <Card className="overflow-hidden">
            <LaundryCalendarComponent />
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={tabOptionsOpen} onOpenChange={setTabOptionsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Calendar options</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Default calendar tab</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { value: "jobs", label: "Jobs calendar" },
                  { value: "laundry", label: "Laundry schedule" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDefaultCalendarTab(option.value as "jobs" | "laundry")}
                    className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                      defaultCalendarTab === option.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTabOptionsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveDefaultCalendarTab}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
