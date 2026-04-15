import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle, XCircle, Clock } from "lucide-react";

export default function JobContinuationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Job Continuations</h1>
        <p className="text-text-secondary mt-1">Manage job continuation requests from cleaners</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Requests</CardTitle>
          <CardDescription>Job continuation and early checkout requests</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cleaner</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { cleaner: "John C.", job: "SNK-ABC123", type: "Continuation", reason: "Need more time for balcony cleaning", status: "PENDING", date: "2026-04-15" },
                { cleaner: "Jane S.", job: "SNK-DEF456", type: "Early Checkout", reason: "All tasks completed ahead of schedule", status: "APPROVED", date: "2026-04-14" },
              ].map((req, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{req.cleaner}</TableCell>
                  <TableCell className="font-mono text-sm">{req.job}</TableCell>
                  <TableCell className="text-sm">{req.type}</TableCell>
                  <TableCell className="text-sm max-w-48 truncate">{req.reason}</TableCell>
                  <TableCell>
                    <Badge variant={req.status === "PENDING" ? "warning" : "success"}>
                      {req.status === "PENDING" && <Clock className="h-3 w-3 mr-1" />}
                      {req.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{req.date}</TableCell>
                  <TableCell>
                    {req.status === "PENDING" && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm"><CheckCircle className="h-4 w-4 text-success-600" /></Button>
                        <Button variant="ghost" size="sm"><XCircle className="h-4 w-4 text-danger-600" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
