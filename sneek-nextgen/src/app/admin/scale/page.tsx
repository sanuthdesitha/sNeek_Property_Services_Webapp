import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Route, Truck, BarChart3, Package, AlertTriangle } from "lucide-react";

export default function ScalePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Scale</h1>
        <p className="text-text-secondary mt-1">Branches, routes, stock forecast, and commercial SLA</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Branches", value: "1", icon: MapPin },
          { label: "Active Routes", value: "3", icon: Route },
          { label: "Stock Forecast", value: "OK", icon: Package },
          { label: "SLA Compliance", value: "94%", icon: BarChart3 },
        ].map((stat) => (
          <Card key={stat.label} variant="outlined">
            <div className="flex items-center gap-3 p-4">
              <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <stat.icon className="h-5 w-5 text-text-secondary" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">{stat.label}</p>
                <p className="text-2xl font-bold">{stat.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">Branches</CardTitle>
            <CardDescription>Manage operational branches</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div>
                  <p className="font-medium text-sm">Sydney HQ</p>
                  <p className="text-xs text-text-tertiary">Primary branch — 8 cleaners, 24 properties</p>
                </div>
                <Badge variant="success">Active</Badge>
              </div>
            </div>
            <Button variant="outline" size="sm" className="mt-4">Add Branch</Button>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">Stock Forecast</CardTitle>
            <CardDescription>Predicted stock needs for next 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { item: "Glass Cleaner", current: 3, predicted: 8, status: "LOW" },
                { item: "Toilet Paper", current: 12, predicted: 20, status: "OK" },
                { item: "Hand Soap", current: 4, predicted: 10, status: "LOW" },
              ].map((item) => (
                <div key={item.item} className="flex items-center justify-between p-2 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <div>
                    <p className="text-sm font-medium">{item.item}</p>
                    <p className="text-xs text-text-tertiary">Current: {item.current} → Predicted: {item.predicted}</p>
                  </div>
                  <Badge variant={item.status === "LOW" ? "danger" : "success"}>{item.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
