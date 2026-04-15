import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon } from "lucide-react";

export default function CleanerCalendarPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Calendar</h1>
        <p className="text-text-secondary mt-1">Your upcoming job schedule</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">April 2026</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { date: "Apr 16", jobs: [{ time: "9:00 AM", property: "City Studio", type: "General Clean" }] },
              { date: "Apr 17", jobs: [{ time: "10:00 AM", property: "Mountain Retreat", type: "End of Lease" }, { time: "3:00 PM", property: "Garden Villa", type: "Airbnb Turnover" }] },
              { date: "Apr 18", jobs: [] },
              { date: "Apr 19", jobs: [{ time: "11:00 AM", property: "Harbour View Apt", type: "Deep Clean" }] },
            ].map((day) => (
              <div key={day.date} className="flex items-start gap-4">
                <div className="w-20 text-sm font-medium text-text-secondary pt-1">{day.date}</div>
                {day.jobs.length > 0 ? (
                  <div className="flex-1 space-y-2">
                    {day.jobs.map((job, i) => (
                      <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 flex items-center gap-3">
                        <CalendarIcon className="h-4 w-4 text-brand-600 shrink-0" />
                        <div>
                          <p className="text-sm font-medium">{job.property}</p>
                          <p className="text-xs text-text-tertiary">{job.time} &middot; {job.type}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-text-tertiary flex-1">No jobs scheduled</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
