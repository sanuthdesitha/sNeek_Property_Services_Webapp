import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Clock, MapPin, CheckCircle } from "lucide-react";

export default function CleanerDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">Welcome back! Here&apos;s your schedule for today.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-100 dark:bg-brand-900/30">
              <Briefcase className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Jobs Today</p>
              <p className="text-2xl font-bold">4</p>
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
              <p className="text-2xl font-bold">2</p>
            </div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning-50 dark:bg-warning-900/30">
              <Clock className="h-5 w-5 text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Est. Hours</p>
              <p className="text-2xl font-bold">6.5</p>
            </div>
          </div>
        </Card>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Today&apos;s Jobs</CardTitle>
          <CardDescription>Your scheduled jobs for today</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { status: "completed", time: "8:00 AM", address: "123 Harbour St, Sydney", type: "Airbnb Turnover", beds: 2, baths: 1 },
              { status: "completed", time: "10:30 AM", address: "45 Ocean Ave, Bondi", type: "Deep Clean", beds: 3, baths: 2 },
              { status: "in-progress", time: "1:00 PM", address: "78 Park Rd, Manly", type: "General Clean", beds: 1, baths: 1 },
              { status: "upcoming", time: "3:30 PM", address: "90 Beach Rd, Coogee", type: "End of Lease", beds: 2, baths: 1 },
            ].map((job, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900"
              >
                <Badge
                  variant={
                    job.status === "completed"
                      ? "success"
                      : job.status === "in-progress"
                        ? "info"
                        : "neutral"
                  }
                >
                  {job.status}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{job.type}</p>
                  <div className="flex items-center gap-3 text-xs text-text-tertiary">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {job.time}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {job.address}
                    </span>
                    <span>{job.beds} bed / {job.baths} bath</span>
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
