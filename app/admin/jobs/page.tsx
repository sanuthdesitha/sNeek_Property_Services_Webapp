"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { AlertTriangle, Kanban, List, Plus, Sparkles, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { MultiSelectDropdown } from "@/components/shared/multi-select-dropdown";
import { toast } from "@/hooks/use-toast";

const JOB_STATUSES = [
  "UNASSIGNED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING_CONTINUATION_APPROVAL",
  "SUBMITTED",
  "QA_REVIEW",
  "COMPLETED",
  "INVOICED",
];
const STATUS_COLORS: Record<string, string> = {
  UNASSIGNED: "warning",
  ASSIGNED: "secondary",
  IN_PROGRESS: "default",
  PAUSED: "warning",
  WAITING_CONTINUATION_APPROVAL: "destructive",
  SUBMITTED: "secondary",
  QA_REVIEW: "warning",
  COMPLETED: "success",
  INVOICED: "outline",
};
const STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  PAUSED: "Paused",
  WAITING_CONTINUATION_APPROVAL: "Waiting Approval",
  SUBMITTED: "Submitted",
  QA_REVIEW: "QA Review",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
};

export default function JobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<any | null>(null);

  const [qaScoreByJob, setQaScoreByJob] = useState<Record<string, string>>({});
  const [qaNotesByJob, setQaNotesByJob] = useState<Record<string, string>>({});
  const [qaSubmittingByJob, setQaSubmittingByJob] = useState<Record<string, boolean>>({});
  const [qaSelectedIds, setQaSelectedIds] = useState<string[]>([]);
  const [batchQaScore, setBatchQaScore] = useState("90");
  const [batchQaNotes, setBatchQaNotes] = useState("");
  const [batchQaSubmitting, setBatchQaSubmitting] = useState(false);
  const [quickAssigningByJob, setQuickAssigningByJob] = useState<Record<string, boolean>>({});
  const [cleaners, setCleaners] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [quickAssignOpen, setQuickAssignOpen] = useState(false);
  const [quickAssignJob, setQuickAssignJob] = useState<any | null>(null);
  const [quickAssignSelected, setQuickAssignSelected] = useState<string[]>([]);
  const [quickAssignSubmitting, setQuickAssignSubmitting] = useState(false);
  const [pendingContinuationRows, setPendingContinuationRows] = useState<any[]>([]);

  async function loadJobs(status = filterStatus) {
    const url = status !== "all" ? `/api/jobs?status=${status}` : "/api/jobs";
    setLoading(true);
    const res = await fetch(url);
    const data = await res.json().catch(() => []);
    setJobs(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function loadPendingContinuations() {
    const res = await fetch("/api/admin/job-continuations?status=PENDING", { cache: "no-store" });
    const data = await res.json().catch(() => []);
    setPendingContinuationRows(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    loadJobs(filterStatus);
    loadPendingContinuations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  useEffect(() => {
    fetch("/api/admin/users?role=CLEANER")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        const next = Array.isArray(rows)
          ? rows
              .map((row: any) => ({
                id: String(row.id ?? ""),
                name: String(row.name ?? row.email ?? "").trim(),
                email: String(row.email ?? "").trim(),
              }))
              .filter((row) => row.id)
          : [];
        setCleaners(next);
      })
      .catch(() => {
        setCleaners([]);
      });
  }, []);

  const qaQueueJobs = useMemo(
    () => jobs.filter((job) => job.status === "SUBMITTED" || job.status === "QA_REVIEW"),
    [jobs]
  );
  const cleanerOptions = useMemo(
    () =>
      cleaners.map((cleaner) => ({
        id: cleaner.id,
        label: cleaner.name || cleaner.email,
        hint: cleaner.email,
      })),
    [cleaners]
  );
  const pendingContinuationJobIds = useMemo(
    () => new Set(pendingContinuationRows.map((row) => row.jobId).filter(Boolean)),
    [pendingContinuationRows]
  );

  useEffect(() => {
    if (qaQueueJobs.length === 0) {
      setQaSelectedIds([]);
      return;
    }
    setQaScoreByJob((prev) => {
      const next = { ...prev };
      for (const job of qaQueueJobs) {
        if (!next[job.id]) {
          const latestScore = job.qaReviews?.[0]?.score;
          next[job.id] = latestScore !== undefined && latestScore !== null ? String(Math.round(latestScore)) : "90";
        }
      }
      return next;
    });
    setQaSelectedIds((prev) => prev.filter((id) => qaQueueJobs.some((job) => job.id === id)));
  }, [qaQueueJobs]);

  function toggleQaSelection(jobId: string) {
    setQaSelectedIds((prev) => {
      if (prev.includes(jobId)) return prev.filter((id) => id !== jobId);
      return [...prev, jobId];
    });
  }

  async function submitQaReview(
    jobId: string,
    options?: { score?: string; notes?: string; suppressToast?: boolean }
  ) {
    const scoreValue = options?.score ?? qaScoreByJob[jobId] ?? "90";
    const notesValue = options?.notes ?? qaNotesByJob[jobId] ?? "";
    const score = Number(scoreValue);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      if (!options?.suppressToast) {
        toast({ title: "Score must be between 0 and 100", variant: "destructive" });
      }
      return false;
    }

    setQaSubmittingByJob((prev) => ({ ...prev, [jobId]: true }));
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, notes: notesValue.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not submit QA review.");
      }
      setQaSelectedIds((prev) => prev.filter((id) => id !== jobId));
      return true;
    } catch (err: any) {
      if (!options?.suppressToast) {
        toast({
          title: "QA failed",
          description: err.message ?? "Could not submit QA review.",
          variant: "destructive",
        });
      }
      return false;
    } finally {
      setQaSubmittingByJob((prev) => ({ ...prev, [jobId]: false }));
    }
  }

  async function submitBatchQa() {
    if (qaSelectedIds.length === 0) {
      toast({ title: "Select at least one job", variant: "destructive" });
      return;
    }
    const score = Number(batchQaScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      toast({ title: "Batch score must be between 0 and 100", variant: "destructive" });
      return;
    }

    setBatchQaSubmitting(true);
    let successCount = 0;
    for (const jobId of qaSelectedIds) {
      const ok = await submitQaReview(jobId, {
        score: String(score),
        notes: batchQaNotes,
        suppressToast: true,
      });
      if (ok) successCount += 1;
    }
    const failCount = qaSelectedIds.length - successCount;
    setBatchQaSubmitting(false);

    if (successCount > 0) {
      toast({
        title: "Batch QA complete",
        description: `${successCount} reviewed${failCount > 0 ? `, ${failCount} failed` : ""}.`,
      });
      await loadJobs();
      router.refresh();
      return;
    }
    toast({ title: "Batch QA failed", description: "No selected jobs were updated.", variant: "destructive" });
  }

  async function deleteJob(credentials?: { pin?: string; password?: string }) {
    if (!jobToDelete?.id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobToDelete.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not delete job.");
      }
      toast({ title: "Job deleted" });
      setDeleteOpen(false);
      setJobToDelete(null);
      await loadJobs();
      await loadPendingContinuations();
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: err.message ?? "Could not delete job.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  function openQuickAssign(job: any) {
    if (!job?.id || job?.status !== "UNASSIGNED") return;
    setQuickAssignJob(job);
    setQuickAssignSelected([]);
    setQuickAssignOpen(true);
  }

  async function submitQuickAssign() {
    if (!quickAssignJob?.id) return;
    if (quickAssignSelected.length === 0) {
      toast({ title: "Select at least one cleaner.", variant: "destructive" });
      return;
    }
    setQuickAssignSubmitting(true);
    setQuickAssigningByJob((prev) => ({ ...prev, [quickAssignJob.id]: true }));
    try {
      const assignRes = await fetch(`/api/admin/jobs/${quickAssignJob.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: quickAssignSelected,
          primaryUserId: quickAssignSelected[0],
        }),
      });
      const assignBody = await assignRes.json().catch(() => ({}));
      if (!assignRes.ok) {
        throw new Error(assignBody.error ?? "Could not assign job.");
      }

      toast({
        title: "Assigned",
        description: `${quickAssignSelected.length} cleaner(s) assigned.`,
      });
      setQuickAssignOpen(false);
      setQuickAssignJob(null);
      setQuickAssignSelected([]);
      await loadJobs();
      await loadPendingContinuations();
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Quick assign failed",
        description: err.message ?? "Could not quick assign this job.",
        variant: "destructive",
      });
    } finally {
      setQuickAssignSubmitting(false);
      if (quickAssignJob?.id) {
        setQuickAssigningByJob((prev) => ({ ...prev, [quickAssignJob.id]: false }));
      }
    }
  }

  const groupedByStatus = JOB_STATUSES.reduce((acc, status) => {
    acc[status] = jobs.filter((job) => job.status === status);
    return acc;
  }, {} as Record<string, any[]>);

  function getAssignmentNames(job: any) {
    const names = Array.isArray(job?.assignments)
      ? job.assignments
          .map((assignment: any) => assignment?.user?.name?.trim() || assignment?.user?.email?.trim() || "")
          .filter(Boolean)
      : [];
    return Array.from(new Set(names));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Jobs</h2>
          <p className="text-sm text-muted-foreground">{jobs.length} jobs</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {JOB_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex rounded-md border">
            <Button
              variant={view === "list" ? "default" : "ghost"}
              size="icon"
              className="rounded-r-none"
              onClick={() => setView("list")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "kanban" ? "default" : "ghost"}
              size="icon"
              className="rounded-l-none"
              onClick={() => setView("kanban")}
            >
              <Kanban className="h-4 w-4" />
            </Button>
          </div>
          <Button asChild>
            <Link href="/admin/jobs/new">
              <Plus className="mr-2 h-4 w-4" />
              New / Bulk
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/ops">
              <Sparkles className="mr-2 h-4 w-4" />
              Ops
            </Link>
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : view === "list" ? (
        <div className="space-y-4">
          {pendingContinuationRows.length > 0 ? (
            <Card className="border-amber-300 bg-amber-50/60">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Pause / Continuation Requests</p>
                    <p className="text-xs text-muted-foreground">
                      These jobs are waiting for admin reschedule approval.
                    </p>
                  </div>
                  <Badge variant="warning">{pendingContinuationRows.length} pending</Badge>
                </div>
                <div className="space-y-2">
                  {pendingContinuationRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex flex-col gap-3 rounded-md border border-amber-300 bg-white/80 p-3 md:flex-row md:items-start md:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {row.job?.property?.name ?? "Job"}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {row.job?.property?.suburb ? `- ${row.job.property.suburb}` : ""}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.job?.jobType ? String(row.job.jobType).replace(/_/g, " ") : "Job"}{" "}
                          {row.job?.scheduledDate ? `- ${format(new Date(row.job.scheduledDate), "dd MMM yyyy")}` : ""}
                        </p>
                        <p className="mt-1 text-xs">
                          <strong>Cleaner:</strong> {row.requestedBy?.name ?? row.requestedBy?.email ?? "Unknown"}
                        </p>
                        <p className="mt-1 text-xs">
                          <strong>Reason:</strong> {row.reason}
                        </p>
                        {row.preferredDate ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Preferred continuation date: {format(new Date(`${row.preferredDate}T00:00:00`), "dd MMM yyyy")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive">Waiting Approval</Badge>
                        <Button size="sm" asChild>
                          <Link href={`/admin/jobs/${row.jobId}`}>Review job</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">QA Queue</p>
                  <p className="text-xs text-muted-foreground">
                    Review submitted jobs inline without opening each job.
                  </p>
                </div>
                <Badge variant="warning">{qaQueueJobs.length} awaiting QA</Badge>
              </div>

              {qaQueueJobs.length > 0 ? (
                <>
                  <div className="grid gap-2 rounded-md border p-3 md:grid-cols-[140px_1fr_auto]">
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Batch score</p>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={batchQaScore}
                        onChange={(e) => setBatchQaScore(e.target.value)}
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Batch notes (optional)</p>
                      <Textarea
                        rows={2}
                        value={batchQaNotes}
                        onChange={(e) => setBatchQaNotes(e.target.value)}
                        placeholder="Applies to selected jobs"
                      />
                    </div>
                    <div className="flex flex-col justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          setQaSelectedIds(
                            qaSelectedIds.length === qaQueueJobs.length ? [] : qaQueueJobs.map((job) => job.id)
                          )
                        }
                      >
                        {qaSelectedIds.length === qaQueueJobs.length ? "Clear selection" : "Select all"}
                      </Button>
                      <Button onClick={submitBatchQa} disabled={batchQaSubmitting || qaSelectedIds.length === 0}>
                        {batchQaSubmitting ? "Applying..." : `Apply to selected (${qaSelectedIds.length})`}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {qaQueueJobs.map((job) => (
                      <div
                        key={job.id}
                        className="grid gap-2 rounded-md border p-3 md:grid-cols-[30px_1.2fr_100px_1fr_auto]"
                      >
                        <div className="pt-1">
                          <Checkbox
                            checked={qaSelectedIds.includes(job.id)}
                            onCheckedChange={() => toggleQaSelection(job.id)}
                          />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{job.property.name}</p>
                            {job.jobNumber ? (
                              <Badge
                                variant="warning"
                                className="border-amber-300 bg-amber-100 text-[10px] font-semibold uppercase tracking-wide text-amber-950"
                              >
                                {job.jobNumber}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {job.property.suburb} - {job.jobType.replace(/_/g, " ")} -{" "}
                            {format(new Date(job.scheduledDate), "dd MMM yyyy")}
                          </p>
                          {job.qaReviews?.[0] ? (
                            <p className="text-xs text-muted-foreground">
                              Last QA: {Math.round(job.qaReviews[0].score)}% ({job.qaReviews[0].passed ? "Passed" : "Failed"})
                            </p>
                          ) : null}
                        </div>
                        <div>
                          <p className="mb-1 text-xs text-muted-foreground">Score</p>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={qaScoreByJob[job.id] ?? "90"}
                            onChange={(e) => setQaScoreByJob((prev) => ({ ...prev, [job.id]: e.target.value }))}
                          />
                        </div>
                        <div>
                          <p className="mb-1 text-xs text-muted-foreground">Notes</p>
                          <Input
                            value={qaNotesByJob[job.id] ?? ""}
                            onChange={(e) => setQaNotesByJob((prev) => ({ ...prev, [job.id]: e.target.value }))}
                            placeholder="Optional QA notes"
                          />
                        </div>
                        <div className="flex flex-wrap items-end justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const ok = await submitQaReview(job.id, { score: "95", notes: qaNotesByJob[job.id] ?? "" });
                              if (ok) {
                                await loadJobs();
                                router.refresh();
                              }
                            }}
                            disabled={Boolean(qaSubmittingByJob[job.id])}
                          >
                            Quick Pass
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const ok = await submitQaReview(job.id, { score: "60", notes: qaNotesByJob[job.id] ?? "" });
                              if (ok) {
                                await loadJobs();
                                router.refresh();
                              }
                            }}
                            disabled={Boolean(qaSubmittingByJob[job.id])}
                          >
                            Flag Rework
                          </Button>
                          <Button
                            size="sm"
                            onClick={async () => {
                              const ok = await submitQaReview(job.id);
                              if (ok) {
                                await loadJobs();
                                router.refresh();
                              }
                            }}
                            disabled={Boolean(qaSubmittingByJob[job.id])}
                          >
                            {qaSubmittingByJob[job.id] ? "Saving..." : "Save QA"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No jobs currently waiting for QA review.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {jobs.map((job) => (
                  (() => {
                    const assignmentNames = getAssignmentNames(job);
                    return (
                  <div
                    key={job.id}
                    className={`flex flex-wrap items-center justify-between gap-3 px-6 py-3 transition-colors hover:bg-muted/50 ${
                      pendingContinuationJobIds.has(job.id) ? "bg-amber-50/50" : ""
                    }`}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/jobs/${job.id}`} className="font-medium text-sm hover:underline">
                          {job.property.name}
                        </Link>
                        {job.jobNumber ? (
                          <Badge
                            variant="warning"
                            className="border-amber-300 bg-amber-100 text-[10px] font-semibold uppercase tracking-wide text-amber-950"
                          >
                            {job.jobNumber}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {job.property.suburb} - {job.jobType.replace(/_/g, " ")} -{" "}
                        {format(new Date(job.scheduledDate), "dd MMM yyyy")}
                        {job.startTime ? ` - ${job.startTime}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {assignmentNames.length > 0 ? (
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {assignmentNames.join(", ")}
                        </span>
                      ) : null}
                      {pendingContinuationJobIds.has(job.id) ? (
                        <Badge variant="destructive">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Continuation pending
                        </Badge>
                      ) : null}
                      <Badge variant={STATUS_COLORS[job.status] as any}>{STATUS_LABELS[job.status]}</Badge>
                      {job.status === "UNASSIGNED" ? (
                        <Button
                          size="sm"
                          onClick={() => openQuickAssign(job)}
                          disabled={Boolean(quickAssigningByJob[job.id])}
                        >
                          <UserPlus className="mr-2 h-4 w-4" />
                          {quickAssigningByJob[job.id] ? "Assigning..." : "Quick Assign"}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/admin/jobs/${job.id}`}>View</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setJobToDelete(job);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                    );
                  })()
                ))}
                {jobs.length === 0 ? (
                  <p className="px-6 py-10 text-center text-sm text-muted-foreground">No jobs match filters.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {["UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW", "COMPLETED"].map((status) => (
            <div key={status} className="min-w-[260px] flex-shrink-0">
              <div className="mb-3 flex items-center gap-2">
                <Badge variant={STATUS_COLORS[status] as any}>{STATUS_LABELS[status]}</Badge>
                <span className="text-xs text-muted-foreground">{groupedByStatus[status]?.length}</span>
              </div>
              <div className="space-y-2">
                {groupedByStatus[status]?.map((job) => (
                  (() => {
                    const assignmentNames = getAssignmentNames(job);
                    return (
                  <Card
                    key={job.id}
                    className={`transition-colors hover:border-primary/50 ${
                      pendingContinuationJobIds.has(job.id) ? "border-amber-300 bg-amber-50/60" : ""
                    }`}
                  >
                    <CardContent className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/jobs/${job.id}`} className="font-medium text-sm hover:underline">
                          {job.property.name}
                        </Link>
                        {job.jobNumber ? (
                          <Badge
                            variant="warning"
                            className="border-amber-300 bg-amber-100 text-[10px] font-semibold uppercase tracking-wide text-amber-950"
                          >
                            {job.jobNumber}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{job.property.suburb}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{job.jobType.replace(/_/g, " ")}</p>
                      <p className="mt-1 text-xs font-medium">{format(new Date(job.scheduledDate), "dd MMM")}</p>
                      {pendingContinuationJobIds.has(job.id) ? (
                        <Badge variant="destructive" className="mt-2">
                          Continuation pending
                        </Badge>
                      ) : null}
                      {assignmentNames.length > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">- {assignmentNames.join(", ")}</p>
                      ) : null}
                      <div className="mt-3 flex gap-2">
                        {status === "UNASSIGNED" ? (
                          <Button
                            size="sm"
                            onClick={() => openQuickAssign(job)}
                            className="flex-1"
                            disabled={Boolean(quickAssigningByJob[job.id])}
                          >
                            <UserPlus className="mr-1 h-4 w-4" />
                            {quickAssigningByJob[job.id] ? "Assigning..." : "Quick Assign"}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" asChild className="flex-1">
                          <Link href={`/admin/jobs/${job.id}`}>View</Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1"
                          onClick={() => {
                            setJobToDelete(job);
                            setDeleteOpen(true);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                    );
                  })()
                ))}
                {groupedByStatus[status]?.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed p-4 text-center text-xs text-muted-foreground">
                    Empty
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={quickAssignOpen}
        onOpenChange={(open) => {
          setQuickAssignOpen(open);
          if (!open) {
            setQuickAssignJob(null);
            setQuickAssignSelected([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Quick Assign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <p className="font-medium">{quickAssignJob?.property?.name ?? "Unassigned job"}</p>
              <p className="text-xs text-muted-foreground">
                {quickAssignJob?.jobType ? String(quickAssignJob.jobType).replace(/_/g, " ") : "-"} -{" "}
                {quickAssignJob?.scheduledDate ? format(new Date(quickAssignJob.scheduledDate), "dd MMM yyyy") : "-"}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Select cleaner(s)</p>
              <MultiSelectDropdown
                options={cleanerOptions}
                selected={quickAssignSelected}
                onChange={setQuickAssignSelected}
                placeholder="Choose cleaners"
                emptyText="No active cleaner accounts."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setQuickAssignOpen(false);
                  setQuickAssignJob(null);
                  setQuickAssignSelected([]);
                }}
                disabled={quickAssignSubmitting}
              >
                Cancel
              </Button>
              <Button onClick={submitQuickAssign} disabled={quickAssignSubmitting}>
                {quickAssignSubmitting ? "Assigning..." : "Assign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete job"
        description={
          jobToDelete
            ? `This will permanently delete the job for ${jobToDelete.property?.name ?? "this property"} on ${format(new Date(jobToDelete.scheduledDate), "dd MMM yyyy")}.`
            : "This will permanently delete the selected job."
        }
        actionKey="deleteJob"
        confirmLabel="Delete job"
        requireSecurityVerification
        loading={deleting}
        onConfirm={deleteJob}
      />
    </div>
  );
}
