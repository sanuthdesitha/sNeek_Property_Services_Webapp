import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Plus, Scale } from "lucide-react";

export default function PayRequestsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Pay Requests</h1>
          <p className="text-text-secondary mt-1">Request pay adjustments for extra work</p>
        </div>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">New Pay Adjustment Request</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <Select label="Scope" options={[{ value: "job", label: "Specific Job" }, { value: "property", label: "Property" }, { value: "standalone", label: "Standalone" }]} placeholder="Select scope" />
            <Input label="Job Number" placeholder="e.g., SNK-ABC123" />
            <Select label="Type" options={[{ value: "HOURLY", label: "Hourly" }, { value: "FIXED", label: "Fixed Amount" }]} placeholder="Select type" />
            <Input label="Requested Hours" type="number" step="0.5" placeholder="2" />
            <Input label="Requested Rate" type="number" placeholder="32" />
            <Textarea label="Reason" placeholder="Explain why you need a pay adjustment..." />
            <Button type="submit"><Plus className="h-4 w-4 mr-2" />Submit Request</Button>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Request History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { job: "SNK-ABC123", type: "HOURLY", requested: "2hrs @ $32", amount: "$64", status: "PENDING", date: "Apr 15" },
              { job: "SNK-DEF456", type: "FIXED", requested: "$50", amount: "$40", status: "APPROVED", date: "Apr 14" },
              { job: "SNK-GHI789", type: "HOURLY", requested: "1hr @ $30", amount: "$30", status: "REJECTED", date: "Apr 13" },
            ].map((req, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <Scale className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{req.job} &middot; {req.type}</p>
                    <p className="text-xs text-text-tertiary">Requested: {req.requested} &middot; {req.date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{req.amount}</p>
                  <Badge variant={req.status === "APPROVED" ? "success" : req.status === "REJECTED" ? "danger" : "warning"}>{req.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
