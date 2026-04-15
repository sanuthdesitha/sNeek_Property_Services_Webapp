import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, MapPin, User } from "lucide-react";

export default function CalendarPage() {
  const days = Array.from({ length: 35 }, (_, i) => {
    const day = i - 2; // offset for April 2026 starting on Wednesday
    return day > 0 && day <= 30 ? day : null;
  });

  const jobsByDay: Record<number, { time: string; type: string; property: string; cleaner: string; status: string }[]> = {
    15: [
      { time: "10:00", type: "Airbnb Turnover", property: "Harbour View", cleaner: "John C.", status: "completed" },
      { time: "14:00", type: "Deep Clean", property: "Beach House", cleaner: "John C.", status: "in-progress" },
    ],
    16: [
      { time: "09:00", type: "General Clean", property: "City Studio", cleaner: "Jane S.", status: "assigned" },
    ],
    17: [
      { time: "10:00", type: "End of Lease", property: "Mountain Retreat", cleaner: "Mike J.", status: "assigned" },
    ],
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Calendar</h1>
        <p className="text-text-secondary mt-1">Job scheduling calendar</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">April 2026</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="success">Completed</Badge>
              <Badge variant="warning">In Progress</Badge>
              <Badge variant="info">Assigned</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-px mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="text-center text-xs font-medium text-text-tertiary py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px">
            {days.map((day, i) => {
              const jobs = day ? jobsByDay[day] : null;
              const isToday = day === 15;
              return (
                <div
                  key={i}
                  className={`min-h-24 p-2 rounded border border-border ${
                    day ? "bg-surface-elevated" : "bg-transparent border-transparent"
                  } ${isToday ? "ring-2 ring-brand-500" : ""}`}
                >
                  {day && (
                    <>
                      <p className={`text-sm font-medium mb-1 ${isToday ? "text-brand-600" : "text-text-primary"}`}>
                        {day}
                      </p>
                      {jobs?.map((job, j) => (
                        <div
                          key={j}
                          className={`text-xs p-1 rounded mb-1 truncate ${
                            job.status === "completed"
                              ? "bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-400"
                              : job.status === "in-progress"
                                ? "bg-warning-50 text-warning-700 dark:bg-warning-900/20 dark:text-warning-400"
                                : "bg-info-50 text-info-700 dark:bg-info-900/20 dark:text-info-400"
                          }`}
                        >
                          <p className="font-medium">{job.time} - {job.type}</p>
                          <p className="text-text-tertiary truncate">{job.property}</p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
