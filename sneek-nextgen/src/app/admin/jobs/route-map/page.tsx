import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Route } from "lucide-react";

export default function RouteMapPage() {
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-text-primary">Route Map</h1><p className="text-text-secondary mt-1">Visualize cleaner routes and job locations</p></div>
      <Card variant="outlined"><CardContent className="pt-6"><div className="h-96 rounded-lg bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center"><div className="text-center"><MapPin className="h-12 w-12 mx-auto mb-2 text-text-tertiary" /><p className="text-text-secondary">Route map requires a mapping library</p></div></div></CardContent></Card>
    </div>
  );
}
