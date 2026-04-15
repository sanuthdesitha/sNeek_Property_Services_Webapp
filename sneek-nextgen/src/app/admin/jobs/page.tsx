import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, Filter, Calendar, MapPin, User } from "lucide-react";

const STATUS_CONFIG: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  UNASSIGNED: "neutral",
  OFFERED: "info",
  ASSIGNED: "info",
  EN_ROUTE: "warning",
  IN_PROGRESS: "warning",
  PAUSED: "danger",
  SUBMITTED: "info",
  QA_REVIEW: "warning",
  COMPLETED: "success",
  INVOICED: "success",
};

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Jobs</h1>
          <p className="text-text-secondary mt-1">Manage and track all cleaning jobs</p>
        </div>
        <Button asChild>
          <Link href="/admin/jobs/new">
            <Plus className="h-4 w-4 mr-2" />
            New Job
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <Card variant="outlined">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-48">
              <Input placeholder="Search jobs..." leftIcon={<Search className="h-4 w-4" />} />
            </div>
            <Select
              options={[
                { value: "", label: "All Statuses" },
                { value: "UNASSIGNED", label: "Unassigned" },
                { value: "ASSIGNED", label: "Assigned" },
                { value: "IN_PROGRESS", label: "In Progress" },
                { value: "COMPLETED", label: "Completed" },
              ]}
              placeholder="Status"
            />
            <Select
              options={[
                { value: "", label: "All Types" },
                { value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" },
                { value: "DEEP_CLEAN", label: "Deep Clean" },
                { value: "END_OF_LEASE", label: "End of Lease" },
                { value: "GENERAL_CLEAN", label: "General Clean" },
              ]}
              placeholder="Type"
            />
            <Input type="date" className="w-40" />
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-1" />
              More Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Jobs Table */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Jobs</CardTitle>
          <CardDescription>Showing 20 of 156 jobs</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cleaner</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { id: "SNK-ABC123", property: "Harbour View Apt", suburb: "Sydney", type: "Airbnb Turnover", date: "2026-04-15", status: "COMPLETED", cleaner: "John C.", estHours: 3, actualHours: 2.5 },
                { id: "SNK-DEF456", property: "Beach House", suburb: "Bondi", type: "Deep Clean", date: "2026-04-15", status: "IN_PROGRESS", cleaner: "John C.", estHours: 5, actualHours: null },
                { id: "SNK-GHI789", property: "City Studio", suburb: "CBD", type: "General Clean", date: "2026-04-15", status: "ASSIGNED", cleaner: "Jane S.", estHours: 2.5, actualHours: null },
                { id: "SNK-JKL012", property: "Mountain Retreat", suburb: "Katoomba", type: "End of Lease", date: "2026-04-16", status: "UNASSIGNED", cleaner: null, estHours: 6, actualHours: null },
                { id: "SNK-MNO345", property: "Garden Villa", suburb: "Parramatta", type: "Pressure Wash", date: "2026-04-16", status: "OFFERED", cleaner: "Mike J.", estHours: 3, actualHours: null },
              ].map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-mono text-sm">{job.id}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{job.property}</p>
                      <p className="text-xs text-text-tertiary flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {job.suburb}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{job.type}</TableCell>
                  <TableCell className="text-sm flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-text-tertiary" />
                    {job.date}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_CONFIG[job.status] ?? "neutral"}>{job.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {job.cleaner ? (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3 text-text-tertiary" />
                        {job.cleaner}
                      </span>
                    ) : (
                      <span className="text-text-tertiary">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {job.actualHours ? `${job.actualHours}h / ${job.estHours}h` : `${job.estHours}h est.`}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/jobs/${job.id}`}>View</Link>
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
