import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Clock } from "lucide-react";

export default function ApprovalsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Approvals</h1>
        <p className="text-text-secondary mt-1">Manage all pending approvals</p>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="client">Client</TabsTrigger>
          <TabsTrigger value="pay">Pay Adjustments</TabsTrigger>
          <TabsTrigger value="time">Time Adjustments</TabsTrigger>
          <TabsTrigger value="shopping">Shopping</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-3">
          {[
            { type: "Pay Adjustment", detail: "John C. requested +2hrs for Job SNK-ABC123", amount: "$64.00", status: "PENDING", date: "10 min ago" },
            { type: "Time Adjustment", detail: "Jane S. requested 30min extension for Job SNK-DEF456", amount: null, status: "PENDING", date: "1 hour ago" },
            { type: "Shopping Settlement", detail: "Glass Cleaner restock - 3 properties", amount: "$45.00", status: "PENDING", date: "2 hours ago" },
            { type: "Client Approval", detail: "Extra task request: Oven clean at Harbour View", amount: "$25.00", status: "PENDING", date: "3 hours ago" },
          ].map((item, i) => (
            <Card key={i} variant="outlined">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">
                        <Clock className="h-3 w-3 mr-1" />
                        {item.status}
                      </Badge>
                      <span className="text-sm font-medium">{item.type}</span>
                    </div>
                    <p className="text-sm text-text-secondary mt-1">{item.detail}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">{item.date}{item.amount && ` &middot; ${item.amount}`}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline">
                      <CheckCircle className="h-4 w-4 mr-1 text-success-600" />
                      Approve
                    </Button>
                    <Button size="sm" variant="outline">
                      <XCircle className="h-4 w-4 mr-1 text-danger-600" />
                      Reject
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="client">
          <Card variant="outlined"><CardContent className="pt-6 text-center text-text-secondary">No pending client approvals</CardContent></Card>
        </TabsContent>
        <TabsContent value="pay">
          <Card variant="outlined"><CardContent className="pt-6 text-center text-text-secondary">No pending pay adjustments</CardContent></Card>
        </TabsContent>
        <TabsContent value="time">
          <Card variant="outlined"><CardContent className="pt-6 text-center text-text-secondary">No pending time adjustments</CardContent></Card>
        </TabsContent>
        <TabsContent value="shopping">
          <Card variant="outlined"><CardContent className="pt-6 text-center text-text-secondary">No pending shopping settlements</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
