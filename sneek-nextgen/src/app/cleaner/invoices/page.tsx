import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";

export default function CleanerInvoicesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Invoices</h1>
        <p className="text-text-secondary mt-1">View and download your pay invoices</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Invoice History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { period: "Apr 1-15, 2026", hours: 42, rate: 32, total: 1344, status: "PENDING" },
              { period: "Mar 16-31, 2026", hours: 38, rate: 32, total: 1216, status: "PAID" },
              { period: "Mar 1-15, 2026", hours: 40, rate: 32, total: 1280, status: "PAID" },
            ].map((inv, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{inv.period}</p>
                    <p className="text-xs text-text-tertiary">{inv.hours}h @ ${inv.rate}/hr</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-semibold">${inv.total}</p>
                    <Badge variant={inv.status === "PAID" ? "success" : "warning"}>{inv.status}</Badge>
                  </div>
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
