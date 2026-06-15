"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  Camera,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Shirt,
  Wrench,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";

type PropertyJob = {
  id: string;
  jobNumber: string | null;
  jobType: string;
  status: string;
  scheduledDate: string | null;
  startTime: string | null;
  dueTime: string | null;
  completedAt: string | null;
  skipped: boolean;
  cleaners: string[];
  qa: { score: number; passed: boolean } | null;
  hasForm: boolean;
  submissionAt: string | null;
  laundryOutcome: string | null;
  hasReport: boolean;
  reportClientVisible: boolean;
  hasLaundry: boolean;
  issueCount: number;
  maintenanceCount: number;
};

type PropertyJobStats = {
  total: number;
  completed: number;
  upcoming: number;
  skipped: number;
  avgQa: number | null;
  qaPassRate: number | null;
  openIssues: number;
  maintenanceItems: number;
  reports: number;
  lastCompleted: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  UNASSIGNED: "warning",
  OFFERED: "warning",
  ASSIGNED: "secondary",
  EN_ROUTE: "warning",
  IN_PROGRESS: "default",
  PAUSED: "warning",
  WAITING_CONTINUATION_APPROVAL: "destructive",
  SUBMITTED: "secondary",
  QA_REVIEW: "warning",
  COMPLETED: "success",
  INVOICED: "outline",
  CANCELLED: "destructive",
};

const LAUNDRY_LABEL: Record<string, string> = {
  READY_FOR_PICKUP: "Laundry ready",
  NOT_READY: "Laundry not ready",
  NO_PICKUP_REQUIRED: "No laundry pickup",
};

function statusLabel(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function jobTypeLabel(value: string) {
  return value.replace(/_/g, " ");
}

function fmtDate(value: string | null, pattern = "dd MMM yyyy") {
  if (!value) return "No date";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "No date" : format(d, pattern);
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function PropertyJobsTab({ propertyId }: { propertyId: string }) {
  const [jobs, setJobs] = useState<PropertyJob[]>([]);
  const [stats, setStats] = useState<PropertyJobStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "completed" | "upcoming" | "issues">("all");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/properties/${propertyId}/jobs`);
        const body = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          toast({ title: "Could not load jobs", description: body.error ?? "Please retry.", variant: "destructive" });
          return;
        }
        setJobs(Array.isArray(body.jobs) ? body.jobs : []);
        setStats(body.stats ?? null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [propertyId]);

  async function downloadReport(jobId: string) {
    setDownloadingId(jobId);
    try {
      await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
    } catch {
      toast({ title: "Download failed", description: "Could not download the report.", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }

  const completedStatuses = new Set(["COMPLETED", "INVOICED"]);
  const visibleJobs = jobs.filter((j) => {
    if (filter === "completed") return completedStatuses.has(j.status);
    if (filter === "upcoming") return !completedStatuses.has(j.status) && j.status !== "CANCELLED" && !j.skipped;
    if (filter === "issues") return j.issueCount > 0 || j.maintenanceCount > 0;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading job history…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Performance roll-up */}
      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Total jobs" value={stats.total} hint={`${stats.completed} completed · ${stats.upcoming} upcoming`} />
          <StatTile label="Avg QA score" value={stats.avgQa != null ? `${stats.avgQa}%` : "—"} hint={stats.qaPassRate != null ? `${stats.qaPassRate}% pass rate` : "No QA yet"} />
          <StatTile label="Open damage cases" value={stats.openIssues} hint={`${stats.maintenanceItems} maintenance items`} />
          <StatTile label="Last completed" value={stats.lastCompleted ? fmtDate(stats.lastCompleted, "dd MMM") : "—"} hint={`${stats.reports} reports · ${stats.skipped} skipped`} />
        </div>
      ) : null}

      {/* Quick navigations across the property */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/cases?propertyId=${propertyId}`}>
            <AlertTriangle className="mr-2 h-4 w-4" />
            Damage cases
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/maintenance?propertyId=${propertyId}`}>
            <Wrench className="mr-2 h-4 w-4" />
            Maintenance
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/reports?propertyId=${propertyId}`}>
            <FileText className="mr-2 h-4 w-4" />
            Reports
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/laundry?propertyId=${propertyId}`}>
            <Shirt className="mr-2 h-4 w-4" />
            Laundry
          </Link>
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {([
          ["all", `All (${jobs.length})`],
          ["completed", `Completed (${stats?.completed ?? 0})`],
          ["upcoming", `Upcoming (${stats?.upcoming ?? 0})`],
          ["issues", `With issues (${jobs.filter((j) => j.issueCount > 0 || j.maintenanceCount > 0).length})`],
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Job list */}
      {visibleJobs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No jobs match this filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibleJobs.map((job) => (
            <Card key={job.id}>
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/jobs/${job.id}`} className="text-sm font-semibold hover:underline">
                      {jobTypeLabel(job.jobType)}
                    </Link>
                    {job.jobNumber ? (
                      <Badge variant="outline" className="text-[10px] tabular-nums">{job.jobNumber}</Badge>
                    ) : null}
                    <Badge variant={STATUS_VARIANT[job.status] ?? "secondary"}>{statusLabel(job.status)}</Badge>
                    {job.skipped ? <Badge variant="destructive">Skipped</Badge> : null}
                    {job.qa ? (
                      <Badge variant={job.qa.passed ? "success" : "destructive"} className="tabular-nums">
                        QA {job.qa.score}%
                      </Badge>
                    ) : null}
                    {job.laundryOutcome ? (
                      <Badge variant="secondary">{LAUNDRY_LABEL[job.laundryOutcome] ?? "Laundry"}</Badge>
                    ) : null}
                    {job.issueCount > 0 ? (
                      <Badge variant="destructive">{job.issueCount} damage</Badge>
                    ) : null}
                    {job.maintenanceCount > 0 ? (
                      <Badge variant="warning">{job.maintenanceCount} to fix</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {fmtDate(job.scheduledDate)}
                    {job.startTime ? ` · ${job.startTime}` : ""}
                    {job.cleaners.length > 0 ? ` · ${job.cleaners.join(", ")}` : " · Unassigned"}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/admin/jobs/${job.id}`}>
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      View
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild disabled={!job.hasForm}>
                    <Link href={`/admin/jobs/${job.id}?tab=submission`}>
                      <Camera className="mr-1.5 h-3.5 w-3.5" />
                      Forms
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadReport(job.id)}
                    disabled={downloadingId === job.id}
                  >
                    {downloadingId === job.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Report
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
