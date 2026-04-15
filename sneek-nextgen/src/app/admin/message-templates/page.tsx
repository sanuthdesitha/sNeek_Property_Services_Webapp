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
import { Plus, Mail, Smartphone } from "lucide-react";

export default function MessageTemplatesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Message Templates</h1>
          <p className="text-text-secondary mt-1">Automated message templates for client communications</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" />New Template</Button>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Templates</CardTitle>
          <CardDescription>Message templates by trigger type</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Job Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { name: "Post-Job Review Request", trigger: "REVIEW_REQUEST", channel: "EMAIL", jobType: "All", active: true },
                { name: "Next Clean Reminder", trigger: "NEXT_CLEAN", channel: "EMAIL", jobType: "All", active: true },
                { name: "Welcome Discount", trigger: "DISCOUNT", channel: "EMAIL", jobType: "All", active: false },
                { name: "Job Confirmation", trigger: "POST_JOB", channel: "SMS", jobType: "AIRBNB_TURNOVER", active: true },
              ].map((template, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{template.name}</TableCell>
                  <TableCell className="text-sm">{template.trigger.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-sm">
                    {template.channel === "EMAIL" ? <Mail className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  </TableCell>
                  <TableCell className="text-sm">{template.jobType}</TableCell>
                  <TableCell>{template.active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}</TableCell>
                  <TableCell><Button variant="ghost" size="sm">Edit</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
