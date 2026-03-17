"use client";

import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, LayoutGrid } from "lucide-react";

// FullCalendar is client-only
const FullCalendarComponent = dynamic(() => import("./_calendar"), { ssr: false, loading: () => <p className="p-8 text-muted-foreground">Loading calendar…</p> });

export default function CalendarPage() {
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
                Review all scheduled jobs in one place, spot clashes early, and jump straight into a job from the calendar card.
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
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <FullCalendarComponent />
      </Card>
    </div>
  );
}
