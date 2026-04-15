import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "lucide-react";

export default function CleanerAvailabilityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Availability</h1>
        <p className="text-text-secondary mt-1">Set your working hours and availability</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Weekly Availability</CardTitle>
          <CardDescription>Set your regular weekly schedule</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => (
              <div key={day} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <Checkbox label={day} defaultChecked={!["Saturday", "Sunday"].includes(day)} />
                <div className="flex items-center gap-2">
                  <Input type="time" defaultValue="07:00" className="w-28" />
                  <span className="text-text-tertiary">to</span>
                  <Input type="time" defaultValue="15:00" className="w-28" />
                </div>
              </div>
            ))}
          </div>
          <Button className="mt-4">Save Schedule</Button>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Date-Specific Availability</CardTitle>
          <CardDescription>Block out specific dates when you're unavailable</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { date: "Apr 20, 2026", reason: "Public Holiday - Easter Monday", allDay: true },
              { date: "Apr 25, 2026", reason: "ANZAC Day", allDay: true },
            ].map((block, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{block.date}</p>
                    <p className="text-xs text-text-tertiary">{block.reason}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm">Remove</Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-4">
            <Input type="date" className="w-40" />
            <Input placeholder="Reason" className="flex-1" />
            <Button size="sm">Block Date</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
