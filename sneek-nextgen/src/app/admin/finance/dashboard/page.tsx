import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, TrendingDown, Clock, FileText } from "lucide-react";

export default function FinanceDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Finance Dashboard</h1>
        <p className="text-text-secondary mt-1">Revenue, margins, and outstanding invoices</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success-50 dark:bg-success-900/30">
              <DollarSign className="h-5 w-5 text-success-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Revenue (MTD)</p>
              <p className="text-2xl font-bold">$24,500</p>
              <p className="text-xs text-success-600 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />+12% vs last month
              </p>
            </div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-50 dark:bg-brand-900/30">
              <TrendingUp className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Avg Margin</p>
              <p className="text-2xl font-bold">35%</p>
              <p className="text-xs text-text-tertiary">Per job average</p>
            </div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning-50 dark:bg-warning-900/30">
              <Clock className="h-5 w-5 text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Outstanding</p>
              <p className="text-2xl font-bold">$3,200</p>
              <p className="text-xs text-warning-600">4 invoices pending</p>
            </div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-danger-50 dark:bg-danger-900/30">
              <TrendingDown className="h-5 w-5 text-danger-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Payroll (MTD)</p>
              <p className="text-2xl font-bold">$8,400</p>
              <p className="text-xs text-text-tertiary">8 cleaners paid</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Outstanding Invoices */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Outstanding Invoices</CardTitle>
          <CardDescription>Invoices awaiting payment</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { number: "INV-2026-4521", client: "Harbour Properties", amount: 1200, days: 5, status: "SENT" },
              { number: "INV-2026-4518", client: "Beach Rentals Co", amount: 850, days: 12, status: "SENT" },
              { number: "INV-2026-4515", client: "City Apartments", amount: 650, days: 18, status: "OVERDUE" },
              { number: "INV-2026-4510", client: "Mountain Retreat", amount: 500, days: 25, status: "OVERDUE" },
            ].map((inv) => (
              <div key={inv.number} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div>
                  <p className="text-sm font-medium">{inv.number}</p>
                  <p className="text-xs text-text-tertiary">{inv.client}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">${inv.amount.toLocaleString()}</p>
                  <Badge variant={inv.status === "OVERDUE" ? "danger" : "warning"}>
                    {inv.days}d {inv.status === "OVERDUE" ? "overdue" : "pending"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
