import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Home, Clock, CheckCircle } from "lucide-react";

export default function ClientDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">Welcome back! Here&apos;s an overview of your services.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-100 dark:bg-brand-900/30">
              <Calendar className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Upcoming Cleans</p>
              <p className="text-2xl font-bold">3</p>
            </div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success-50 dark:bg-success-900/30">
              <CheckCircle className="h-5 w-5 text-success-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Completed This Month</p>
              <p className="text-2xl font-bold">8</p>
            </div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-info-50 dark:bg-info-900/30">
              <Home className="h-5 w-5 text-info-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Properties</p>
              <p className="text-2xl font-bold">2</p>
            </div>
          </div>
        </Card>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Upcoming Jobs</CardTitle>
          <CardDescription>Your next scheduled cleaning services</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { date: "Tomorrow", time: "10:00 AM", property: "Harbour View Apartment", type: "Airbnb Turnover", status: "confirmed" },
              { date: "Fri, 18 Apr", time: "2:00 PM", property: "Beach House", type: "Deep Clean", status: "confirmed" },
              { date: "Mon, 21 Apr", time: "9:00 AM", property: "Harbour View Apartment", type: "General Clean", status: "pending" },
            ].map((job, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900"
              >
                <Badge variant={job.status === "confirmed" ? "success" : "warning"}>
                  {job.status}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{job.type}</p>
                  <div className="flex items-center gap-3 text-xs text-text-tertiary">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {job.date} at {job.time}
                    </span>
                    <span className="flex items-center gap-1">
                      <Home className="h-3 w-3" />
                      {job.property}
                    </span>
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
