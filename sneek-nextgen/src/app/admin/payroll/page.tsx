import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, DollarSign, FileDown } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "info" | "danger" | "neutral"; label: string }> = {
  DRAFT: { variant: "neutral" as const, label: "Draft" },
  CONFIRMED: { variant: "info" as const, label: "Confirmed" },
  PROCESSING: { variant: "warning" as const, label: "Processing" },
  COMPLETED: { variant: "success" as const, label: "Completed" },
  FAILED: { variant: "danger" as const, label: "Failed" },
  VOID: { variant: "danger" as const, label: "Void" },
};

export default function PayrollPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Payroll</h1>
          <p className="text-text-secondary mt-1">Manage payroll runs and payouts</p>
        </div>
        <Button asChild>
          <Link href="/admin/payroll/new">
            <Plus className="h-4 w-4 mr-2" />
            New Payroll Run
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Payroll Runs</CardTitle>
          <CardDescription>All payroll processing runs</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cleaners</TableHead>
                <TableHead>Wages</TableHead>
                <TableHead>Reimbursements</TableHead>
                <TableHead>Allowances</TableHead>
                <TableHead>Grand Total</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { period: "Apr 1-15, 2026", status: "DRAFT", cleaners: 8, wages: 6400, reimbursements: 320, allowances: 200, total: 6920 },
                { period: "Mar 16-31, 2026", status: "COMPLETED", cleaners: 8, wages: 6200, reimbursements: 280, allowances: 150, total: 6630 },
                { period: "Mar 1-15, 2026", status: "COMPLETED", cleaners: 7, wages: 5800, reimbursements: 250, allowances: 180, total: 6230 },
              ].map((run, i) => {
                const config = STATUS_CONFIG[run.status];
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">{run.period}</TableCell>
                    <TableCell><Badge variant={config.variant}>{config.label}</Badge></TableCell>
                    <TableCell className="text-sm">{run.cleaners}</TableCell>
                    <TableCell className="text-sm">${run.wages.toLocaleString()}</TableCell>
                    <TableCell className="text-sm">${run.reimbursements.toLocaleString()}</TableCell>
                    <TableCell className="text-sm">${run.allowances.toLocaleString()}</TableCell>
                    <TableCell className="font-semibold">${run.total.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/payroll/${i}`}>View</Link>
                        </Button>
                        {run.status === "COMPLETED" && (
                          <Button variant="ghost" size="sm"><FileDown className="h-4 w-4" /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
