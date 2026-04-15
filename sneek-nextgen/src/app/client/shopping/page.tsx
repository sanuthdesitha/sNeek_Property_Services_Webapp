import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Download } from "lucide-react";

export default function ClientShoppingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Shopping</h1>
        <p className="text-text-secondary mt-1">View shopping run history for your properties</p>
      </div>

      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">Shopping Run History</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { title: "Weekly Restock - Harbour View", property: "Harbour View Apt", items: 8, cost: 45.50, status: "APPROVED" },
              { title: "Monthly Stock Up", property: "Beach House", items: 15, cost: 120.00, status: "BILLED" },
            ].map((run, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <ShoppingCart className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{run.title}</p>
                    <p className="text-xs text-text-tertiary">{run.property} &middot; {run.items} items &middot; ${run.cost.toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={run.status === "BILLED" ? "success" : "info"}>{run.status}</Badge>
                  <Button variant="ghost" size="sm"><Download className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
