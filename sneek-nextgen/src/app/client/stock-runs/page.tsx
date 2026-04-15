import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList } from "lucide-react";

export default function ClientStockRunsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Stock Runs</h1>
        <p className="text-text-secondary mt-1">View stock count history for your properties</p>
      </div>

      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">Stock Run History</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { title: "Monthly Stock Count - Harbour View", property: "Harbour View Apt", items: 10, status: "APPLIED" },
              { title: "Quarterly Audit - Beach House", property: "Beach House", items: 10, status: "APPLIED" },
            ].map((run, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <ClipboardList className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{run.title}</p>
                    <p className="text-xs text-text-tertiary">{run.property} &middot; {run.items} items counted</p>
                  </div>
                </div>
                <Badge variant="success">{run.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
