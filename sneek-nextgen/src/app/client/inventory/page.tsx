import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";

export default function ClientInventoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Inventory</h1>
        <p className="text-text-secondary mt-1">View stock levels at your properties</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Harbour View Apartment</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { name: "All-Purpose Cleaner", onHand: 5, parLevel: 10, threshold: 3 },
              { name: "Glass Cleaner", onHand: 2, parLevel: 10, threshold: 3 },
              { name: "Toilet Paper (Roll)", onHand: 8, parLevel: 12, threshold: 4 },
              { name: "Hand Soap (500ml)", onHand: 3, parLevel: 6, threshold: 2 },
            ].map((item) => (
              <div key={item.name} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <Package className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-text-tertiary">Par level: {item.parLevel}</p>
                  </div>
                </div>
                <Badge variant={item.onHand <= item.threshold ? "danger" : "success"}>{item.onHand} on hand</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
