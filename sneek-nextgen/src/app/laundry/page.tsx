import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shirt, Clock, CheckCircle, AlertTriangle } from "lucide-react";

export default function LaundryDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Laundry Dashboard</h1>
        <p className="text-text-secondary mt-1">Manage your laundry tasks and schedules.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-100 dark:bg-brand-900/30">
              <Shirt className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Tasks Today</p>
              <p className="text-2xl font-bold">6</p>
            </div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success-50 dark:bg-success-900/30">
              <CheckCircle className="h-5 w-5 text-success-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Completed</p>
              <p className="text-2xl font-bold">3</p>
            </div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning-50 dark:bg-warning-900/30">
              <AlertTriangle className="h-5 w-5 text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Flagged</p>
              <p className="text-2xl font-bold">1</p>
            </div>
          </div>
        </Card>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Today&apos;s Tasks</CardTitle>
          <CardDescription>Laundry tasks scheduled for today</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { property: "Harbour View Apt", status: "pending", time: "10:00 AM", bags: 2 },
              { property: "Beach House", status: "picked-up", time: "11:30 AM", bags: 3 },
              { property: "City Studio", status: "confirmed", time: "1:00 PM", bags: 1 },
              { property: "Mountain Retreat", status: "flagged", time: "2:30 PM", bags: 4 },
            ].map((task, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900"
              >
                <Badge
                  variant={
                    task.status === "picked-up"
                      ? "success"
                      : task.status === "flagged"
                        ? "danger"
                        : task.status === "confirmed"
                          ? "info"
                          : "neutral"
                  }
                >
                  {task.status}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{task.property}</p>
                  <div className="flex items-center gap-3 text-xs text-text-tertiary">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {task.time}
                    </span>
                    <span>{task.bags} bag{task.bags > 1 ? "s" : ""}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
