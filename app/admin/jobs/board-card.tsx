"use client";

import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { AlertTriangle, User, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

const TZ = "Australia/Sydney";

function getAssignmentNames(job: any): string[] {
  const names = Array.isArray(job?.assignments)
    ? job.assignments
        .map((assignment: any) => assignment?.user?.name?.trim() || assignment?.user?.email?.trim() || "")
        .filter(Boolean)
    : [];
  return Array.from(new Set<string>(names));
}

type BoardCardProps = {
  job: any;
  selected: boolean;
  onToggleSelect: (jobId: string) => void;
  onQuickAssign: (job: any) => void;
  onDelete: (job: any) => void;
  quickAssigning?: boolean;
  pendingContinuation?: boolean;
  slaStatus?: "overdue" | "due-soon" | null;
};

/**
 * A single board (kanban) card. Renders the same job fields as the list row but
 * in a stacked card layout. The assigned cleaner name is always shown (with a
 * person icon, or "Unassigned"), at every breakpoint.
 */
export function BoardCard({
  job,
  selected,
  onToggleSelect,
  onQuickAssign,
  onDelete,
  quickAssigning = false,
  pendingContinuation = false,
  slaStatus = null,
}: BoardCardProps) {
  const status = String(job?.status ?? "");
  const assignmentNames = getAssignmentNames(job);
  const hasDamage = Array.isArray(job?.issueTickets) && job.issueTickets.length > 0;
  const isSkipped = String(job?.cleanSkipStatus ?? "") === "SKIPPED";
  const skipRequested = String(job?.cleanSkipStatus ?? "") === "REQUESTED";

  return (
    <Card
      className={`transition-colors hover:border-primary/50 ${
        pendingContinuation ? "border-warning/40 bg-warning/10" : ""
      }`}
    >
      <CardContent className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(job.id)} />
          <span className="text-xs text-muted-foreground">Select</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/jobs/${job.id}`} className="text-sm font-medium hover:underline">
            {job.property?.name ?? "Unknown property"}
          </Link>
          {job.jobNumber ? (
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
        </div>
        <p className="text-xs text-muted-foreground">{job.property?.suburb ?? ""}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {job.jobType ? String(job.jobType).replace(/_/g, " ") : "Job"}
        </p>
        <p className="mt-1 text-xs font-medium tabular-nums">
          {job.scheduledDate && !Number.isNaN(new Date(job.scheduledDate).getTime())
            ? format(toZonedTime(new Date(job.scheduledDate), TZ), "dd MMM")
            : "No date"}
          {job?.startTime ? <span className="tabular-nums"> - {job.startTime}</span> : ""}
        </p>
        {/* Assigned cleaner — always visible on the card. */}
        <p className="mt-1.5 flex items-center gap-1.5 text-xs">
          <User className="h-3 w-3 shrink-0 text-muted-foreground" />
          {assignmentNames.length > 0 ? (
            <span className="font-medium text-foreground">{assignmentNames.join(", ")}</span>
          ) : (
            <span className="text-muted-foreground/70">Unassigned</span>
          )}
        </p>
        {pendingContinuation ? (
          <Badge variant="destructive" className="mt-2">
            Continuation pending
          </Badge>
        ) : null}
        {isSkipped ? (
          <Badge variant="destructive" className="mt-2">
            Skipped — no clean
          </Badge>
        ) : null}
        {skipRequested ? (
          <Badge variant="warning" className="mt-2">
            Skip requested
          </Badge>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {job.gpsDistanceMeters != null ? (
            <Badge variant={job.gpsDistanceMeters < 500 ? "success" : "warning"}>
              {job.gpsDistanceMeters < 500 ? "On-site" : `${job.gpsDistanceMeters}m away`}
            </Badge>
          ) : null}
          {slaStatus === "overdue" ? <Badge variant="destructive">Overdue</Badge> : null}
          {slaStatus === "due-soon" ? <Badge variant="warning">Due soon</Badge> : null}
        </div>
        <div className="mt-3 flex gap-2">
          {status === "UNASSIGNED" ? (
            <Button
              size="sm"
              onClick={() => onQuickAssign(job)}
              className="flex-1"
              disabled={quickAssigning}
            >
              <UserPlus className="mr-1 h-4 w-4" />
              {quickAssigning ? "Assigning..." : "Quick Assign"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" asChild className="flex-1">
            <Link href={`/admin/jobs/${job.id}`}>View</Link>
          </Button>
          <Button size="sm" variant="destructive" className="flex-1" onClick={() => onDelete(job)}>
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
