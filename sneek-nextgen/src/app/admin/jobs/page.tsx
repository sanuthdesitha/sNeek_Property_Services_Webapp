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
import { prisma } from "@/lib/db/prisma";

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

async function getJobs() {
  const jobs = await prisma.job.findMany({
    take: 20,
    orderBy: { scheduledDate: "desc" },
    include: {
      property: { select: { name: true, suburb: true } },
      assignments: { include: { user: { select: { name: true } } } },
    },
  });
  return jobs;
}

export default async function JobsPage() {
  const jobs = await getJobs();

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
          <CardDescription>Showing {jobs.length} jobs</CardDescription>
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
              {jobs.length > 0 ? jobs.map((job) => {
                const cleaner = job.assignments.find((a) => a.isPrimary)?.user;
                return (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-sm">{job.jobNumber ?? job.id.slice(0, 8)}</td>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{job.property?.name ?? "Unknown"}</p>
                        <p className="text-xs text-text-tertiary flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {job.property?.suburb ?? ""}
                        </p>
                      </div>
                    </td>
                    <TableCell className="text-sm">{job.jobType.replace(/_/g, " ")}</td>
                    <TableCell className="text-sm flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-text-tertiary" />
                      {job.scheduledDate?.toLocaleDateString()}
                    </td>
                    <TableCell>
                      <Badge variant={STATUS_CONFIG[job.status] ?? "neutral"}>{job.status.replace(/_/g, " ")}</Badge>
                    </td>
                    <TableCell className="text-sm">
                      {cleaner ? (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3 text-text-tertiary" />
                          {cleaner.name}
                        </span>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                    <TableCell className="text-sm">
                      {job.actualHours ? `${job.actualHours}h / ${job.estimatedHours}h` : `${job.estimatedHours}h est.`}
                    </td>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/jobs/${job.id}`}>View</Link>
                      </Button>
                    </td>
                  </TableRow>
                );
              }) : (
                <TableRow>
                  <td colSpan={8} className="text-center text-text-tertiary py-8">No jobs found</td>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
