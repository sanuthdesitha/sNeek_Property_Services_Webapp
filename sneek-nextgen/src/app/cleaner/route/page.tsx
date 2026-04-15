import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Navigation, Play, Pause, Flag, AlertTriangle } from "lucide-react";

export default function CleanerRoutePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Today&apos;s Route</h1>
          <p className="text-text-secondary mt-1">Navigate between your jobs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline"><Pause className="h-4 w-4 mr-2" />Pause</Button>
          <Button><Play className="h-4 w-4 mr-2" />Start Driving</Button>
        </div>
      </div>

      {/* Map placeholder */}
      <Card variant="outlined">
        <CardContent className="pt-6">
          <div className="h-64 rounded-lg bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center">
            <div className="text-center">
              <MapPin className="h-8 w-8 mx-auto mb-2 text-text-tertiary" />
              <p className="text-text-secondary">Route map requires a mapping library</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Route stops */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Route Stops</CardTitle>
          <CardDescription>4 stops scheduled for today</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { order: 1, property: "Harbour View Apt", address: "123 Harbour St, Sydney", time: "10:00 AM", type: "Airbnb Turnover", status: "completed" },
              { order: 2, property: "Beach House", address: "45 Ocean Ave, Bondi", time: "2:00 PM", type: "Deep Clean", status: "in-progress" },
              { order: 3, property: "City Studio", address: "78 Park Rd, Manly", time: "4:30 PM", type: "General Clean", status: "upcoming" },
              { order: 4, property: "Garden Villa", address: "90 Beach Rd, Coogee", time: "6:00 PM", type: "End of Lease", status: "upcoming" },
            ].map((stop) => (
              <div key={stop.order} className="flex items-start gap-4 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white text-sm font-bold shrink-0">
                  {stop.order}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{stop.property}</p>
                    <Badge variant={stop.status === "completed" ? "success" : stop.status === "in-progress" ? "warning" : "neutral"}>
                      {stop.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-tertiary flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" />{stop.address}
                  </p>
                  <p className="text-xs text-text-tertiary mt-0.5">{stop.time} &middot; {stop.type}</p>
                </div>
                {stop.status === "upcoming" && (
                  <Button variant="ghost" size="sm"><Navigation className="h-4 w-4" /></Button>
                )}
                {stop.status === "in-progress" && (
                  <Button variant="outline" size="sm"><Flag className="h-4 w-4 mr-1" />Arrived</Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
