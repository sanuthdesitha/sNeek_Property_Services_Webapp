import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Clock } from "lucide-react";

export default function LiveLocationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Live Locations</h1>
        <p className="text-text-secondary mt-1">Real-time cleaner GPS tracking</p>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-6">
          <div className="h-64 rounded-lg bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center mb-6">
            <div className="text-center">
              <MapPin className="h-12 w-12 mx-auto mb-2 text-text-tertiary" />
              <p className="text-text-secondary">Live map requires a mapping library</p>
            </div>
          </div>

          <div className="space-y-3">
            {[
              { name: "John C.", job: "SNK-DEF456", lat: -33.8915, lng: 151.2767, accuracy: 12, lastPing: "30 sec ago" },
              { name: "Jane S.", job: "SNK-GHI789", lat: -33.8688, lng: 151.2093, accuracy: 8, lastPing: "1 min ago" },
            ].map((ping, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <Navigation className="h-4 w-4 text-brand-600" />
                  <div>
                    <p className="text-sm font-medium">{ping.name}</p>
                    <p className="text-xs text-text-tertiary">{ping.lat.toFixed(4)}, {ping.lng.toFixed(4)} &middot; ±{ping.accuracy}m</p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant="success">Active</Badge>
                  <p className="text-xs text-text-tertiary mt-1 flex items-center gap-1 justify-end">
                    <Clock className="h-3 w-3" />{ping.lastPing}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
