import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, Clock } from "lucide-react";

export default function ClientFinancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Finance</h1>
        <p className="text-text-secondary mt-1">View your financial summary and payment history</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-success-50 dark:bg-success-900/30"><DollarSign className="h-5 w-5 text-success-600" /></div>
            <div><p className="text-sm text-text-secondary">Total Paid (MTD)</p><p className="text-2xl font-bold">$2,400</p></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-warning-50 dark:bg-warning-900/30"><Clock className="h-5 w-5 text-warning-600" /></div>
            <div><p className="text-sm text-text-secondary">Outstanding</p><p className="text-2xl font-bold">$1,200</p></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-brand-50 dark:bg-brand-900/30"><TrendingUp className="h-5 w-5 text-brand-600" /></div>
            <div><p className="text-sm text-text-secondary">Jobs This Month</p><p className="text-2xl font-bold">8</p></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
