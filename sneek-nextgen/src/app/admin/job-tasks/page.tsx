import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, CheckCircle, Clock, XCircle } from "lucide-react";

export default function JobTasksPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Job Tasks</h1>
          <p className="text-text-secondary mt-1">Manage client and admin requested tasks</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" />New Task</Button>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-4">
          <Input placeholder="Search tasks..." leftIcon={<Search className="h-4 w-4" />} />
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Tasks</CardTitle>
          <CardDescription>Job tasks across all properties</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Execution</TableHead>
                <TableHead>Photo Required</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { title: "Clean oven interior", property: "Harbour View", source: "CLIENT", approval: "APPROVED", execution: "COMPLETED", photo: true },
                { title: "Wipe balcony furniture", property: "Beach House", source: "ADMIN", approval: "AUTO_APPROVED", execution: "OPEN", photo: false },
                { title: "Deep clean grout", property: "City Studio", source: "CLIENT", approval: "PENDING_APPROVAL", execution: "OPEN", photo: true },
              ].map((task, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{task.title}</TableCell>
                  <TableCell className="text-sm">{task.property}</TableCell>
                  <TableCell className="text-sm">{task.source}</TableCell>
                  <TableCell>
                    <Badge variant={task.approval === "APPROVED" || task.approval === "AUTO_APPROVED" ? "success" : task.approval === "PENDING_APPROVAL" ? "warning" : "neutral"}>
                      {task.approval.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={task.execution === "COMPLETED" ? "success" : task.execution === "OPEN" ? "info" : "neutral"}>
                      {task.execution.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{task.photo ? "Yes" : "No"}</TableCell>
                  <TableCell><Button variant="ghost" size="sm">View</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
