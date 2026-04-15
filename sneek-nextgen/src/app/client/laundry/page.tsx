import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shirt } from "lucide-react";

export default function ClientLaundryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Laundry</h1>
        <p className="text-text-secondary mt-1">View laundry tasks and status</p>
      </div>

      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">Laundry Tasks</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { property: "Harbour View Apt", pickup: "Apr 16", dropoff: "Apr 18", status: "PENDING", bags: 2 },
              { property: "Beach House", pickup: "Apr 15", dropoff: "Apr 17", status: "PICKED_UP", bags: 3 },
            ].map((task, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <Shirt className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{task.property}</p>
                    <p className="text-xs text-text-tertiary">Pickup: {task.pickup} → Dropoff: {task.dropoff} &middot; {task.bags} bags</p>
                  </div>
                </div>
                <Badge variant={task.status === "PICKED_UP" ? "warning" : "neutral"}>{task.status.replace(/_/g, " ")}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}