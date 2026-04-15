import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";

export default function LaundryInvoicesPage() {
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-text-primary">Invoices</h1><p className="text-text-secondary mt-1">Laundry service invoices</p></div>
      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">Invoice History</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { number: "INV-LAUNDRY-001", period: "Apr 1-15", total: 450, status: "PAID" },
              { number: "INV-LAUNDRY-002", period: "Mar 16-31", total: 380, status: "PAID" },
            ].map((inv) => (
              <div key={inv.number} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{inv.number}</p>
                    <p className="text-xs text-text-tertiary">{inv.period}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">${inv.total}</p>
                  <Badge variant="success">{inv.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
