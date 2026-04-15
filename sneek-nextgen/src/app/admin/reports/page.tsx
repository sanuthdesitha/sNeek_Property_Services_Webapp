import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Search, Download, Eye, Send } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Reports</h1>
        <p className="text-text-secondary mt-1">View and manage cleaning reports</p>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-48">
              <Input placeholder="Search reports..." leftIcon={<Search className="h-4 w-4" />} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Reports</CardTitle>
          <CardDescription>Generated cleaning reports</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead>QA Score</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { job: "SNK-ABC123", property: "Harbour View Apt", type: "Airbnb Turnover", date: "2026-04-15", qaScore: 92, sent: true },
                { job: "SNK-DEF456", property: "Beach House", type: "Deep Clean", date: "2026-04-14", qaScore: 85, sent: true },
                { job: "SNK-GHI789", property: "City Studio", type: "General Clean", date: "2026-04-13", qaScore: 78, sent: false },
              ].map((report) => (
                <TableRow key={report.job}>
                  <TableCell className="font-mono text-sm">{report.job}</TableCell>
                  <TableCell className="text-sm">{report.property}</TableCell>
                  <TableCell className="text-sm">{report.type}</TableCell>
                  <TableCell className="text-sm">{report.date}</TableCell>
                  <TableCell>
                    <Badge variant={report.qaScore >= 80 ? "success" : "warning"}>{report.qaScore}%</Badge>
                  </TableCell>
                  <TableCell>
                    {report.sent ? <Badge variant="success">Sent</Badge> : <Badge variant="neutral">Draft</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm"><Download className="h-4 w-4" /></Button>
                      {!report.sent && <Button variant="ghost" size="sm"><Send className="h-4 w-4" /></Button>}
                    </div>
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
