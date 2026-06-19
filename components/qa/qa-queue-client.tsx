"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Inbox, Loader2, RefreshCw, UserCheck, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ChartCard, KpiTile, DonutStat } from "@/components/charts";

type Inspector = { id: string; name: string | null; email: string; role: string };

function jobTitle(job: any) {
  return `${job?.property?.name ?? "Property"} - ${String(job?.jobType ?? "Job").replace(/_/g, " ")}`;
}

function statusTone(status: string) {
  if (status === "COMPLETED") return "success";
  if (status === "QA_REVIEW") return "warning";
  return "secondary";
}

export function QaQueueClient({ inspectors }: { inspectors: Inspector[] }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({ assignments: [], unassignedJobs: [] });
  const [selectedInspector, setSelectedInspector] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/qa/queue", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast({ title: "Could not load QA queue", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    setData(body);
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const assigned = (data.assignments ?? []).map((assignment: any) => ({
      key: assignment.id,
      jobId: assignment.jobId,
      assignment,
      job: assignment.job,
      assigned: true,
    }));
    const unassigned = (data.unassignedJobs ?? []).map((job: any) => ({
      key: `job-${job.id}`,
      jobId: job.id,
      assignment: null,
      job,
      assigned: false,
    }));
    return [...assigned, ...unassigned];
  }, [data]);

  // Real queue counts derived from the loaded rows — no fabricated metrics.
  const stats = useMemo(() => {
    const total = rows.length;
    const unassigned = rows.filter((row) => !row.assigned).length;
    const inProgress = rows.filter(
      (row) => row.assignment?.pickedUpById || row.assignment?.status === "IN_PROGRESS"
    ).length;
    const assigned = total - unassigned - inProgress;
    return { total, unassigned, assigned: Math.max(0, assigned), inProgress };
  }, [rows]);

  const statusSlices = useMemo(
    () =>
      [
        { label: "Unassigned", value: stats.unassigned, tone: "warning" as const },
        { label: "Assigned", value: stats.assigned, tone: "info" as const },
        { label: "In progress", value: stats.inProgress, tone: "primary" as const },
      ].filter((slice) => slice.value > 0),
    [stats]
  );

  async function bulkAssign() {
    if (!selectedInspector || selectedJobs.length === 0) return;
    const res = await fetch("/api/admin/qa/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds: selectedJobs, assignedToId: selectedInspector }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "QA assignment failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    toast({ title: "QA assigned", description: `${body.created ?? selectedJobs.length} job(s) assigned.` });
    setSelectedJobs([]);
    await load();
  }

  async function pickup(jobId: string) {
    const res = await fetch(`/api/qa/jobs/${jobId}/pickup`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Could not pick up QA", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    toast({ title: "QA picked up" });
    await load();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="QA Queue"
        description="Review submitted jobs and assign inspections."
        icon={<ClipboardCheck />}
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {!loading && (
        <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile label="In queue" value={stats.total} icon={<Inbox />} tone="primary" />
            <KpiTile label="Unassigned" value={stats.unassigned} icon={<ClipboardCheck />} tone="warning" />
            <KpiTile label="Assigned" value={stats.assigned} icon={<UserCheck />} tone="info" />
            <KpiTile label="In progress" value={stats.inProgress} icon={<Loader2 />} tone="accent" />
          </div>
          {statusSlices.length > 0 ? (
            <ChartCard title="Queue Mix" subtitle="Submitted jobs awaiting QA by stage.">
              <DonutStat
                slices={statusSlices}
                height={220}
                centerValue={stats.total}
                centerLabel="Jobs"
              />
            </ChartCard>
          ) : null}
        </section>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bulk assign inspections</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Select value={selectedInspector} onValueChange={setSelectedInspector}>
            <SelectTrigger>
              <SelectValue placeholder="Select QA inspector or OPS manager" />
            </SelectTrigger>
            <SelectContent>
              {inspectors.map((inspector) => (
                <SelectItem key={inspector.id} value={inspector.id}>
                  {inspector.name || inspector.email} ({inspector.role.replace(/_/g, " ")})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void bulkAssign()} disabled={!selectedInspector || selectedJobs.length === 0}>
            <UserPlus className="mr-2 h-4 w-4" />
            Assign {selectedJobs.length || ""}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {loading ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Loading QA queue...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No submitted jobs are waiting for QA.
          </div>
        ) : (
          rows.map((row) => (
            <Card key={row.key} className="overflow-hidden">
              <CardContent className="grid gap-3 p-4 lg:grid-cols-[auto_1fr_auto] lg:items-center">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary"
                  checked={selectedJobs.includes(row.jobId)}
                  onChange={(event) =>
                    setSelectedJobs((prev) =>
                      event.target.checked ? [...prev, row.jobId] : prev.filter((id) => id !== row.jobId)
                    )
                  }
                  aria-label={`Select ${jobTitle(row.job)}`}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">{jobTitle(row.job)}</p>
                    <Badge variant={statusTone(row.job?.status) as any}>{String(row.job?.status ?? "").replace(/_/g, " ")}</Badge>
                    <Badge variant={row.assigned ? "secondary" : "outline"}>
                      {row.assigned ? String(row.assignment.status).replace(/_/g, " ") : "Unassigned"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {row.job?.property?.address}, {row.job?.property?.suburb}
                  </p>
                  {row.job?.scheduledDate || row.job?.completedAt ? (
                    <p className="text-xs font-medium text-foreground">
                      {row.job?.scheduledDate
                        ? new Date(row.job.scheduledDate).toLocaleDateString(undefined, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : null}
                      {row.job?.completedAt
                        ? ` · Completed ${new Date(row.job.completedAt).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          })}`
                        : ""}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Cleaner: {row.job?.assignments?.map((a: any) => a.user?.name || a.user?.email).join(", ") || "N/A"}
                    {row.assignment?.assignedTo ? ` · Assigned to ${row.assignment.assignedTo.name || row.assignment.assignedTo.email}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {!row.assignment?.pickedUpById ? (
                    <Button variant="outline" size="sm" onClick={() => void pickup(row.jobId)}>
                      <ClipboardCheck className="mr-2 h-4 w-4" />
                      Pick up
                    </Button>
                  ) : null}
                  <Button size="sm" asChild>
                    <Link href={`/qa/jobs/${row.jobId}`}>Open QA</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
