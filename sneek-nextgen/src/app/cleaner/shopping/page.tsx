import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Plus } from "lucide-react";

export default function CleanerShoppingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Shopping</h1>
          <p className="text-text-secondary mt-1">Manage shopping runs and receipts</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" />New Shopping Run</Button>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Shopping Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { title: "Weekly Restock - Harbour View", items: 8, cost: 45.50, status: "SUBMITTED" },
              { title: "Emergency Supplies - Beach House", items: 3, cost: 22.00, status: "APPROVED" },
              { title: "Monthly Stock Up", items: 15, cost: 120.00, status: "CLOSED" },
            ].map((run, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <ShoppingCart className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{run.title}</p>
                    <p className="text-xs text-text-tertiary">{run.items} items &middot; ${run.cost.toFixed(2)}</p>
                  </div>
                </div>
                <Badge variant={run.status === "APPROVED" ? "success" : run.status === "CLOSED" ? "neutral" : "warning"}>{run.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
