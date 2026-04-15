import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Plus, AlertTriangle } from "lucide-react";

export default function ClientDisputesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Disputes</h1>
          <p className="text-text-secondary mt-1">Raise and track disputes</p>
        </div>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">New Dispute</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <Select label="Related Job" options={[{ value: "SNK-ABC123", label: "SNK-ABC123 - Harbour View" }]} placeholder="Select job" />
            <Select label="Dispute Type" options={[{ value: "quality", label: "Quality Issue" }, { value: "billing", label: "Billing Dispute" }, { value: "damage", label: "Property Damage" }, { value: "other", label: "Other" }]} placeholder="Select type" />
            <Textarea label="Description" placeholder="Describe the issue in detail..." />
            <Button type="submit"><Plus className="h-4 w-4 mr-2" />Submit Dispute</Button>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Dispute History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { job: "SNK-GHI789", type: "Quality Issue", description: "Kitchen not cleaned to standard", status: "RESOLVED", date: "Apr 10" },
            ].map((dispute, i) => (
              <div key={i} className="flex items-start justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-warning-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">{dispute.type} &middot; {dispute.job}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">{dispute.description}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">{dispute.date}</p>
                  </div>
                </div>
                <Badge variant={dispute.status === "RESOLVED" ? "success" : "warning"}>{dispute.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
