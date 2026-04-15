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
import { Clock, CheckCircle, XCircle } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "info" | "danger" | "neutral"; label: string }> = {
  PENDING: { variant: "warning" as const, label: "Pending" },
  APPROVED: { variant: "success" as const, label: "Approved" },
  REJECTED: { variant: "danger" as const, label: "Rejected" },
};

export default function TimeAdjustmentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Time Adjustments</h1>
        <p className="text-text-secondary mt-1">Review and approve cleaner time adjustment requests</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Requests</CardTitle>
          <CardDescription>Time adjustment requests from cleaners</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cleaner</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Original</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { cleaner: "Jane S.", job: "SNK-DEF456", original: "4h 30m", requested: "5h 00m", reason: "Extra bathroom deep clean needed", status: "PENDING", date: "2026-04-15" },
                { cleaner: "John C.", job: "SNK-ABC123", original: "2h 30m", requested: "3h 00m", reason: "Heavy mess in kitchen", status: "APPROVED", date: "2026-04-14" },
                { cleaner: "Mike J.", job: "SNK-GHI789", original: "3h 00m", requested: "3h 30m", reason: "Traffic delay", status: "REJECTED", date: "2026-04-13" },
              ].map((req, i) => {
                const config = STATUS_CONFIG[req.status];
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">{req.cleaner}</TableCell>
                    <TableCell className="font-mono text-sm">{req.job}</TableCell>
                    <TableCell className="text-sm flex items-center gap-1"><Clock className="h-3 w-3 text-text-tertiary" />{req.original}</TableCell>
                    <TableCell className="text-sm font-medium">{req.requested}</TableCell>
                    <TableCell className="text-sm max-w-48 truncate">{req.reason}</TableCell>
                    <TableCell><Badge variant={config.variant}>{config.label}</Badge></TableCell>
                    <TableCell className="text-sm">{req.date}</TableCell>
                    <TableCell>
                      {req.status === "PENDING" && (
                        <div className="flex items-center gap-1">
                          <button className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"><CheckCircle className="h-4 w-4 text-success-600" /></button>
                          <button className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"><XCircle className="h-4 w-4 text-danger-600" /></button>
                        </div>
                      )}
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