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
import { Plus, ClipboardList } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "info" | "danger" | "neutral"; label: string }> = {
  DRAFT: { variant: "neutral" as const, label: "Draft" },
  ACTIVE: { variant: "info" as const, label: "Active" },
  SUBMITTED: { variant: "warning" as const, label: "Submitted" },
  APPLIED: { variant: "success" as const, label: "Applied" },
  DISCARDED: { variant: "danger" as const, label: "Discarded" },
};

export default function StockRunsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Stock Runs</h1>
          <p className="text-text-secondary mt-1">Manage stock counts and adjustments</p>
        </div>
        <Button asChild>
          <Link href="/admin/stock-runs/new">
            <Plus className="h-4 w-4 mr-2" />
            New Stock Run
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Stock Runs</CardTitle>
          <CardDescription>Stock count history</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Items Counted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { title: "Monthly Stock Count - Harbour View", property: "Harbour View Apt", requestedBy: "Admin User", items: 10, status: "APPLIED" },
                { title: "Quarterly Audit - Beach House", property: "Beach House", requestedBy: "Ops Manager", items: 10, status: "SUBMITTED" },
                { title: "Emergency Count - City Studio", property: "City Studio", requestedBy: "Admin User", items: 5, status: "DRAFT" },
              ].map((run, i) => {
                const config = STATUS_CONFIG[run.status];
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-text-tertiary" />
                      {run.title}
                    </TableCell>
                    <TableCell className="text-sm">{run.property}</TableCell>
                    <TableCell className="text-sm">{run.requestedBy}</TableCell>
                    <TableCell className="text-sm">{run.items}</TableCell>
                    <TableCell><Badge variant={config.variant}>{config.label}</Badge></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/stock-runs/${i}`}>View</Link>
                      </Button>
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
