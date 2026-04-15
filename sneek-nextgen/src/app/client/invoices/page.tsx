import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, DollarSign, Download, ExternalLink } from "lucide-react";

export default function ClientInvoicesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Invoices</h1>
        <p className="text-text-secondary mt-1">View and pay your invoices</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Invoice History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { number: "INV-2026-4521", period: "Apr 1-15", subtotal: 1090.91, gst: 109.09, total: 1200, status: "SENT" },
              { number: "INV-2026-4510", period: "Mar 1-15", subtotal: 590.91, gst: 59.09, total: 650, status: "PAID" },
            ].map((inv) => (
              <div key={inv.number} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{inv.number}</p>
                    <p className="text-xs text-text-tertiary">{inv.period} &middot; Subtotal: ${inv.subtotal.toFixed(2)} + GST: ${inv.gst.toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-semibold">${inv.total.toFixed(2)}</p>
                    <Badge variant={inv.status === "PAID" ? "success" : "warning"}>{inv.status}</Badge>
                  </div>
                  {inv.status === "SENT" && <Button size="sm"><DollarSign className="h-4 w-4 mr-1" />Pay</Button>}
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
