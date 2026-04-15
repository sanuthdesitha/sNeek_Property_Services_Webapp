import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Clock } from "lucide-react";

export default function ClientApprovalsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Approvals</h1>
        <p className="text-text-secondary mt-1">Review and approve additional tasks and charges</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Pending Approvals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { type: "Additional Task", detail: "Oven clean at Harbour View Apartment", cost: "$25", date: "Apr 15" },
              { type: "Shopping Settlement", detail: "Glass Cleaner restock - 3 properties", cost: "$45", date: "Apr 14" },
            ].map((item, i) => (
              <div key={i} className="flex items-start justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="warning"><Clock className="h-3 w-3 mr-1" />Pending</Badge>
                    <span className="text-sm font-medium">{item.type}</span>
                  </div>
                  <p className="text-sm text-text-secondary mt-1">{item.detail}</p>
                  <p className="text-xs text-text-tertiary mt-0.5">{item.date} &middot; {item.cost}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline"><CheckCircle className="h-4 w-4 mr-1 text-success-600" />Approve</Button>
                  <Button size="sm" variant="outline"><XCircle className="h-4 w-4 mr-1 text-danger-600" />Decline</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
