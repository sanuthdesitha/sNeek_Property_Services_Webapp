import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Clock } from "lucide-react";

export default function OpsMapPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Ops Map</h1>
        <p className="text-text-secondary mt-1">Live cleaner location tracking and job map</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map placeholder */}
        <Card variant="outlined" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Live Map</CardTitle>
            <CardDescription>Real-time cleaner locations and job sites</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-96 rounded-lg bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center">
              <div className="text-center">
                <MapPin className="h-12 w-12 mx-auto mb-2 text-text-tertiary" />
                <p className="text-text-secondary">Map view requires a mapping library</p>
                <p className="text-xs text-text-tertiary mt-1">Recommended: Leaflet or Mapbox GL</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cleaner locations */}
        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">Cleaner Locations</CardTitle>
            <CardDescription>Active cleaner GPS pings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { name: "John C.", job: "SNK-DEF456", location: "Bondi", status: "in-progress", lastPing: "2 min ago" },
                { name: "Jane S.", job: "SNK-GHI789", location: "CBD", status: "en-route", lastPing: "5 min ago" },
                { name: "Mike J.", job: "SNK-JKL012", location: "Katoomba", status: "assigned", lastPing: "15 min ago" },
              ].map((cleaner, i) => (
                <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Navigation className="h-4 w-4 text-brand-600" />
                      <div>
                        <p className="text-sm font-medium">{cleaner.name}</p>
                        <p className="text-xs text-text-tertiary">{cleaner.location} &middot; {cleaner.job}</p>
                      </div>
                    </div>
                    <Badge variant={cleaner.status === "in-progress" ? "warning" : "info"}>{cleaner.status}</Badge>
                  </div>
                  <p className="text-xs text-text-tertiary mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />Last ping: {cleaner.lastPing}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
