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
import { Scale, CheckCircle, XCircle } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "info" | "danger" | "neutral"; label: string }> = {
  PENDING: { variant: "warning" as const, label: "Pending" },
  APPROVED: { variant: "success" as const, label: "Approved" },
  REJECTED: { variant: "danger" as const, label: "Rejected" },
};

export default function PayAdjustmentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Pay Adjustments</h1>
        <p className="text-text-secondary mt-1">Review and approve cleaner pay adjustment requests</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Requests</CardTitle>
          <CardDescription>Pay adjustment requests from cleaners</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cleaner</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { cleaner: "John C.", scope: "Job SNK-ABC123", type: "HOURLY", requested: "2hrs @ $32", approved: null, status: "PENDING", date: "2026-04-15" },
                { cleaner: "Jane S.", scope: "Property: Beach House", type: "FIXED", requested: "$50", approved: "$40", status: "APPROVED", date: "2026-04-14" },
                { cleaner: "Mike J.", scope: "Standalone", type: "HOURLY", requested: "1hr @ $30", approved: null, status: "REJECTED", date: "2026-04-13" },
              ].map((req, i) => {
                const config = STATUS_CONFIG[req.status];
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">{req.cleaner}</TableCell>
                    <TableCell className="text-sm">{req.scope}</TableCell>
                    <TableCell className="text-sm">{req.type}</TableCell>
                    <TableCell className="text-sm">{req.requested}</TableCell>
                    <TableCell className="text-sm">{req.approved ?? "—"}</TableCell>
                    <TableCell><Badge variant={config.variant}>{config.label}</Badge></TableCell>
                    <TableCell className="text-sm">{req.date}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {req.status === "PENDING" && (
                          <>
                            <Button variant="ghost" size="sm"><CheckCircle className="h-4 w-4 text-success-600" /></Button>
                            <Button variant="ghost" size="sm"><XCircle className="h-4 w-4 text-danger-600" /></Button>
                          </>
                        )}
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/pay-adjustments/${i}`}>View</Link>
                        </Button>
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
