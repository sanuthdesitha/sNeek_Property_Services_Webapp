import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, MessageSquare } from "lucide-react";

export default function ClientCasesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Cases</h1>
          <p className="text-text-secondary mt-1">Track and manage your support cases</p>
        </div>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">New Case</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <Input label="Subject" placeholder="Brief description of the issue" />
            <Textarea label="Description" placeholder="Provide details about your issue..." />
            <Button type="submit"><Plus className="h-4 w-4 mr-2" />Create Case</Button>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Case History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { subject: "Missing items after clean", status: "OPEN", date: "Apr 14", replies: 2 },
              { subject: "Request for extra cleaner", status: "RESOLVED", date: "Apr 10", replies: 4 },
            ].map((c, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{c.subject}</p>
                    <p className="text-xs text-text-tertiary">{c.date} &middot; {c.replies} replies</p>
                  </div>
                </div>
                <Badge variant={c.status === "OPEN" ? "warning" : "success"}>{c.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
