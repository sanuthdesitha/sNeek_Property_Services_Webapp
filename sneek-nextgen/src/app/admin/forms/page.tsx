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
import { Plus, FileText } from "lucide-react";

export default function FormsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Forms</h1>
          <p className="text-text-secondary mt-1">Manage form templates and submissions</p>
        </div>
        <Button asChild>
          <Link href="/admin/forms/new">
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Form Templates</CardTitle>
          <CardDescription>Cleaning checklists and form templates</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Service Type</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submissions</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { name: "Airbnb Turnover Checklist", type: "Airbnb Turnover", version: 1, active: true, submissions: 24 },
                { name: "Deep Clean Checklist", type: "Deep Clean", version: 1, active: true, submissions: 12 },
                { name: "End of Lease Checklist", type: "End of Lease", version: 1, active: true, submissions: 8 },
                { name: "General Clean Checklist", type: "General Clean", version: 1, active: true, submissions: 15 },
              ].map((template, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4 text-text-tertiary" />
                    {template.name}
                  </TableCell>
                  <TableCell className="text-sm">{template.type}</TableCell>
                  <TableCell className="text-sm">v{template.version}</TableCell>
                  <TableCell>{template.active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}</TableCell>
                  <TableCell className="text-sm">{template.submissions}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/forms/${i}`}>Edit</Link>
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
