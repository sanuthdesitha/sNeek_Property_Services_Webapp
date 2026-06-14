"use client";

import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { AlertTriangle, CalendarClock, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const TZ = "Australia/Sydney";

export const STATUS_COLORS: Record<string, string> = {
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
};

export const STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  OFFERED: "Awaiting Confirmation",
  ASSIGNED: "Assigned",
  EN_ROUTE: "On the way",
  IN_PROGRESS: "In Progress",
  PAUSED: "Paused",
  WAITING_CONTINUATION_APPROVAL: "Waiting Approval",
  SUBMITTED: "Submitted",
  QA_REVIEW: "QA Review",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
};

/** Safely format a scheduled date in the Sydney timezone, tolerating null/invalid values. */
function formatScheduled(value: unknown, pattern = "dd MMM yyyy"): string {
  if (!value) return "No date";
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) return "No date";
  return format(toZonedTime(parsed, TZ), pattern);
}

function getAssignmentNames(job: any): string[] {
  const names = Array.isArray(job?.assignments)
    ? job.assignments
        .map((assignment: any) => assignment?.user?.name?.trim() || assignment?.user?.email?.trim() || "")
        .filter(Boolean)
    : [];
  return Array.from(new Set<string>(names));
}

function getLatestQa(job: any): { score: number; passed: boolean } | null {
  const review = Array.isArray(job?.qaReviews) ? job.qaReviews[0] : null;
  if (!review || review.score === null || review.score === undefined) return null;
  return { score: Math.round(Number(review.score)), passed: Boolean(review.passed) };
}

type JobRowProps = {
  job: any;
  selected: boolean;
  onToggleSelect: (jobId: string) => void;
  onQuickAssign: (job: any) => void;
  onDelete: (job: any) => void;
  quickAssigning?: boolean;
  pendingContinuation?: boolean;
  pendingReschedule?: boolean;
  slaStatus?: "overdue" | "due-soon" | null;
};

/**
 * Single unified job row. Renders the SAME populated fields for every job
 * regardless of status (property, suburb, job#, type, date/time, cleaner,
 * status, QA, actions). Every field is null-guarded so completed jobs — which
 * previously rendered blank — now show their full details.
 */
export function JobRow({
  job,
  selected,
  onToggleSelect,
  onQuickAssign,
  onDelete,
  quickAssigning = false,
  pendingContinuation = false,
  pendingReschedule = false,
  slaStatus = null,
}: JobRowProps) {
  const propertyName = job?.property?.name ?? "Unknown property";
  const suburb = job?.property?.suburb ?? "";
  const jobType = job?.jobType ? String(job.jobType).replace(/_/g, " ") : "Job";
  const status = String(job?.status ?? "");
  const assignmentNames = getAssignmentNames(job);
  const hasDamage = Array.isArray(job?.issueTickets) && job.issueTickets.length > 0;
  const qa = getLatestQa(job);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-6 py-3 transition-colors hover:bg-muted/50 ${
        pendingContinuation ? "bg-warning/10" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="pt-1">
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(job.id)} />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/jobs/${job.id}`} className="text-sm font-medium hover:underline">
              {propertyName}
            </Link>
            {job?.jobNumber ? (
              <Badge
                variant="warning"
                className="border-amber-300 bg-amber-100 text-[10px] font-semibold uppercase tracking-wide text-amber-950 tabular-nums"
              >
                {job.jobNumber}
              </Badge>
            ) : null}
            {hasDamage ? (
              <Button
                size="sm"
                variant="outline"
                asChild
                className="h-6 border-red-300 px-2 text-red-700 hover:bg-red-50 hover:text-red-800"
              >
                <Link href={`/admin/cases?jobId=${job.id}`}>
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  Damage
                </Link>
              </Button>
            ) : null}
            {pendingReschedule ? (
              <Button
                size="sm"
                variant="outline"
                asChild
                className="h-6 border-amber-300 bg-amber-50 px-2 text-amber-800 hover:bg-amber-100"
              >
                <Link href="/admin/approvals">
                  <CalendarClock className="mr-1 h-3 w-3" />
                  Reschedule req
                </Link>
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {suburb ? `${suburb} - ` : ""}
            {jobType} - <span className="tabular-nums">{formatScheduled(job?.scheduledDate)}</span>
            {job?.startTime ? <span className="tabular-nums"> - {job.startTime}</span> : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {job?.gpsDistanceMeters != null ? (
              <Badge variant={job.gpsDistanceMeters < 500 ? "success" : "warning"}>
                {job.gpsDistanceMeters < 500 ? "On-site" : `${job.gpsDistanceMeters}m away`}
              </Badge>
            ) : null}
            {qa ? (
              <Badge variant={qa.passed ? "success" : "destructive"} className="tabular-nums">
                QA {qa.score}%
              </Badge>
            ) : null}
            {slaStatus === "overdue" ? <Badge variant="destructive">Overdue</Badge> : null}
            {slaStatus === "due-soon" ? <Badge variant="warning">Due soon</Badge> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {assignmentNames.length > 0 ? (
          <span className="hidden text-xs text-muted-foreground sm:block">{assignmentNames.join(", ")}</span>
        ) : (
          <span className="hidden text-xs text-muted-foreground/70 sm:block">Unassigned</span>
        )}
        {pendingContinuation ? (
          <Badge variant="destructive">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Continuation pending
          </Badge>
        ) : null}
        <Badge variant={(STATUS_COLORS[status] ?? "secondary") as any}>{STATUS_LABELS[status] ?? status}</Badge>
        {status === "UNASSIGNED" ? (
          <Button size="sm" onClick={() => onQuickAssign(job)} disabled={quickAssigning}>
            <UserPlus className="mr-2 h-4 w-4" />
            {quickAssigning ? "Assigning..." : "Quick Assign"}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" asChild>
          <Link href={`/admin/jobs/${job.id}`}>View</Link>
        </Button>
        <Button size="sm" variant="destructive" onClick={() => onDelete(job)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>
    </div>
  );
}
