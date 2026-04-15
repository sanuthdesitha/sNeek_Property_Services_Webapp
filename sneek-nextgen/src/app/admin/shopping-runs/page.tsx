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
import { Plus, ShoppingCart } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "info" | "danger" | "neutral"; label: string }> = {
  DRAFT: { variant: "neutral" as const, label: "Draft" },
  ACTIVE: { variant: "info" as const, label: "Active" },
  SUBMITTED: { variant: "warning" as const, label: "Submitted" },
  APPROVED: { variant: "success" as const, label: "Approved" },
  BILLED: { variant: "success" as const, label: "Billed" },
  REIMBURSED: { variant: "success" as const, label: "Reimbursed" },
  CLOSED: { variant: "neutral" as const, label: "Closed" },
};

export default function ShoppingRunsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Shopping Runs</h1>
          <p className="text-text-secondary mt-1">Manage shopping runs and reimbursements</p>
        </div>
        <Button asChild>
          <Link href="/admin/shopping-runs/new">
            <Plus className="h-4 w-4 mr-2" />
            New Shopping Run
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Shopping Runs</CardTitle>
          <CardDescription>Shopping run history</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { title: "Weekly Restock - Harbour View", owner: "John C.", client: "Harbour Properties", items: 8, cost: 45.50, status: "SUBMITTED" },
                { title: "Emergency Supplies - Beach House", owner: "Jane S.", client: "Harbour Properties", items: 3, cost: 22.00, status: "APPROVED" },
                { title: "Monthly Stock Up", owner: "John C.", client: null, items: 15, cost: 120.00, status: "CLOSED" },
              ].map((run, i) => {
                const config = STATUS_CONFIG[run.status];
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm flex items-center gap-2">
                      <ShoppingCart className="h-4 w-4 text-text-tertiary" />
                      {run.title}
                    </TableCell>
                    <TableCell className="text-sm">{run.owner}</TableCell>
                    <TableCell className="text-sm">{run.client ?? "—"}</TableCell>
                    <TableCell className="text-sm">{run.items}</TableCell>
                    <TableCell className="font-medium">${run.cost.toFixed(2)}</TableCell>
                    <TableCell><Badge variant={config.variant}>{config.label}</Badge></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/shopping-runs/${i}`}>View</Link>
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
