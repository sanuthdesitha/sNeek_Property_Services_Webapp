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
import { Plus, Search, AlertCircle } from "lucide-react";

export default function CasesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Cases & Issues</h1>
          <p className="text-text-secondary mt-1">Track and resolve operational issues</p>
        </div>
        <Button asChild>
          <Link href="/admin/cases/new">
            <Plus className="h-4 w-4 mr-2" />
            New Case
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-48">
              <Input placeholder="Search cases..." leftIcon={<Search className="h-4 w-4" />} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Cases</CardTitle>
          <CardDescription>Open and resolved cases</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { title: "Damage report - Harbour View", type: "OPS", severity: "HIGH", status: "OPEN", assigned: "Admin User", date: "2026-04-15" },
                { title: "Missing items - Beach House", type: "CLIENT", severity: "MEDIUM", status: "IN_PROGRESS", assigned: "Ops Manager", date: "2026-04-14" },
                { title: "Cleaner late - City Studio", type: "OPS", severity: "LOW", status: "RESOLVED", assigned: "Admin User", date: "2026-04-13" },
              ].map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-text-tertiary" />
                    {c.title}
                  </TableCell>
                  <TableCell className="text-sm">{c.type}</TableCell>
                  <TableCell>
                    <Badge variant={c.severity === "HIGH" ? "danger" : c.severity === "MEDIUM" ? "warning" : "neutral"}>
                      {c.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.status === "OPEN" ? "danger" : c.status === "IN_PROGRESS" ? "warning" : "success"}>
                      {c.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{c.assigned}</TableCell>
                  <TableCell className="text-sm">{c.date}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/cases/${i}`}>View</Link>
                    </Button>
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
