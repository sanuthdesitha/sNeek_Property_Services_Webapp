import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon } from "lucide-react";

export default function LaundryCalendarPage() {
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-text-primary">Calendar</h1><p className="text-text-secondary mt-1">Laundry pickup and delivery schedule</p></div>
      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">April 2026</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { date: "Apr 16", tasks: [{ time: "9:00 AM", property: "Harbour View Apt", type: "Pickup", bags: 3 }] },
              { date: "Apr 17", tasks: [{ time: "2:00 PM", property: "Beach House", type: "Dropoff", bags: 3 }] },
              { date: "Apr 18", tasks: [{ time: "10:00 AM", property: "City Studio", type: "Pickup", bags: 2 }] },
            ].map((day) => (
              <div key={day.date} className="flex items-start gap-4">
                <div className="w-20 text-sm font-medium text-text-secondary pt-1">{day.date}</div>
                <div className="flex-1 space-y-2">
                  {day.tasks.map((task, i) => (
                    <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 flex items-center gap-3">
                      <CalendarIcon className="h-4 w-4 text-brand-600 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{task.property}</p>
                        <p className="text-xs text-text-tertiary">{task.time} &middot; {task.type} &middot; {task.bags} bags</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
