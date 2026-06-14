"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Loader2,
  MessageSquareMore,
  Shirt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ClientJobTaskRequestDialog } from "@/components/client/job-task-request-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TZ = "Australia/Sydney";
const STORAGE_KEY = "sneek_client_jobs_filter";

type FilterMode = "all" | "today" | "tomorrow" | "week" | "date";
type ViewMode = "list" | "calendar";

function toLocalDate(value: string | Date) {
  return toZonedTime(new Date(value), TZ);
}

function toDayKey(value: string | Date) {
  return format(toLocalDate(value), "yyyy-MM-dd");
}

function todayKey() {
  return format(toZonedTime(new Date(), TZ), "yyyy-MM-dd");
}

function tomorrowKey() {
  const base = toZonedTime(new Date(), TZ);
  return format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1), "yyyy-MM-dd");
}

function withinNextWeek(value: string | Date) {
  const today = new Date(`${todayKey()}T00:00:00`);
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  const current = new Date(`${toDayKey(value)}T00:00:00`);
  return current >= today && current <= end;
}

function matchesFilter(job: any, mode: FilterMode, selectedDate: string) {
  const key = toDayKey(job.scheduledDate);
  if (mode === "today") return key === todayKey();
  if (mode === "tomorrow") return key === tomorrowKey();
  if (mode === "week") return withinNextWeek(job.scheduledDate);
  if (mode === "date") return selectedDate ? key === selectedDate : true;
  return true;
}

function sortJobs(jobs: any[]) {
  return [...jobs].sort((left, right) => new Date(left.scheduledDate).getTime() - new Date(right.scheduledDate).getTime());
}

function buildLaundrySummary(task: any) {
  const latestConfirmation = task?.confirmations?.[0] ?? null;
  const latestMeta = latestConfirmation?.meta ?? null;

  if (!task) return null;

  if (task.adminOverrideNote) {
    return {
      title: "Admin update",
      detail: task.adminOverrideNote,
      charge: typeof latestMeta?.totalPrice === "number" ? latestMeta.totalPrice : null,
    };
  }

  if (task.status === "SKIPPED_PICKUP" || task.noPickupRequired) {
    return {
      title: "Pickup update",
      detail: [
        task.skipReasonCode ? String(task.skipReasonCode).replace(/_/g, " ") : "No pickup required",
        task.skipReasonNote || null,
      ]
        .filter(Boolean)
        .join(" • "),
      charge: typeof latestMeta?.totalPrice === "number" ? latestMeta.totalPrice : null,
    };
  }

  if (latestConfirmation) {
    return {
      title: latestConfirmation.laundryReady ? "Cleaner marked laundry ready" : "Laundry update recorded",
      detail: [
        format(new Date(latestConfirmation.createdAt), "dd MMM yyyy HH:mm"),
        latestConfirmation.bagLocation || null,
      ]
        .filter(Boolean)
        .join(" • "),
      charge: typeof latestMeta?.totalPrice === "number" ? latestMeta.totalPrice : null,
    };
  }

  if (task.droppedAt) {
    return {
      title: "Laundry returned",
      detail: format(toLocalDate(task.droppedAt), "dd MMM yyyy"),
      charge: null,
    };
  }

  return {
    title: "Laundry schedule created",
    detail: `Pickup ${format(toLocalDate(task.pickupDate), "dd MMM yyyy")}`,
    charge: null,
  };
}

export function ClientJobsWorkspace({
  jobs,
  showCleanerNames,
  showClientTaskRequests,
  showLaundryUpdates,
}: {
  jobs: any[];
  showCleanerNames: boolean;
  showClientTaskRequests: boolean;
  showLaundryUpdates: boolean;
}) {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showPastJobs, setShowPastJobs] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(toZonedTime(new Date(), TZ)));
  const [actionJob, setActionJob] = useState<any | null>(null);
  const [actionMode, setActionMode] = useState<"reschedule" | "cancel" | null>(null);
  const [requestedDate, setRequestedDate] = useState("");
  const [cancelReason, setCancelReason] = useState("slot change");
  const [submittingAction, setSubmittingAction] = useState(false);
  const router = useRouter();
  // Local skip-state overlay so the card reflects a request/cancel immediately
  // without a full reload. Keyed by job id.
  const [skipOverrides, setSkipOverrides] = useState<Record<string, string>>({});
  const [skipJob, setSkipJob] = useState<any | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [submittingSkip, setSubmittingSkip] = useState(false);
  const [cancellingSkipId, setCancellingSkipId] = useState<string | null>(null);

  function skipStatusFor(job: any): string {
    return skipOverrides[job.id] ?? job.cleanSkipStatus ?? "NONE";
  }

  async function submitSkipRequest() {
    if (!skipJob) return;
    setSubmittingSkip(true);
    try {
      const res = await fetch(`/api/client/jobs/${skipJob.id}/skip-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: skipReason.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send skip request.");
      setSkipOverrides((prev) => ({ ...prev, [skipJob.id]: "REQUESTED" }));
      toast({
        title: "Skip request sent",
        description: "Admin has been notified and will review whether to skip this clean.",
      });
      setSkipJob(null);
      setSkipReason("");
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Request failed",
        description: error?.message ?? "Could not send skip request.",
        variant: "destructive",
      });
    } finally {
      setSubmittingSkip(false);
    }
  }

  async function cancelSkipRequest(job: any) {
    setCancellingSkipId(job.id);
    try {
      const res = await fetch(`/api/client/jobs/${job.id}/skip-request`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not cancel skip request.");
      setSkipOverrides((prev) => ({ ...prev, [job.id]: "NONE" }));
      toast({ title: "Skip request cancelled", description: "The clean will go ahead as scheduled." });
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Cancel failed",
        description: error?.message ?? "Could not cancel skip request.",
        variant: "destructive",
      });
    } finally {
      setCancellingSkipId(null);
    }
  }

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { filterMode?: FilterMode; selectedDate?: string; viewMode?: ViewMode };
      if (parsed.filterMode) setFilterMode(parsed.filterMode);
      if (parsed.selectedDate) setSelectedDate(parsed.selectedDate);
      if (parsed.viewMode) setViewMode(parsed.viewMode);
    } catch {
      // ignore invalid local state
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ filterMode, selectedDate, viewMode }));
  }, [filterMode, selectedDate, viewMode]);

  const filteredJobs = useMemo(
    () => sortJobs(jobs).filter((job) => matchesFilter(job, filterMode, selectedDate)),
    [jobs, filterMode, selectedDate]
  );
  const currentDayKey = todayKey();
  const upcomingJobs = useMemo(
    () => filteredJobs.filter((job) => toDayKey(job.scheduledDate) >= currentDayKey),
    [currentDayKey, filteredJobs]
  );
  const pastJobs = useMemo(
    () =>
      [...filteredJobs.filter((job) => toDayKey(job.scheduledDate) < currentDayKey)].sort(
        (left, right) => new Date(right.scheduledDate).getTime() - new Date(left.scheduledDate).getTime()
      ),
    [currentDayKey, filteredJobs]
  );
  const jobDayKeys = useMemo(() => new Set(jobs.map((job) => toDayKey(job.scheduledDate))), [jobs]);
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(calendarMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(calendarMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [calendarMonth]);

  function openAction(job: any, mode: "reschedule" | "cancel") {
    setActionJob(job);
    setActionMode(mode);
    setRequestedDate(toDayKey(job.scheduledDate));
    setCancelReason("slot change");
  }

  function closeAction() {
    setActionJob(null);
    setActionMode(null);
    setRequestedDate("");
    setCancelReason("slot change");
  }

  async function submitAction() {
    if (!actionJob || !actionMode) return;
    setSubmittingAction(true);
    try {
      const endpoint =
        actionMode === "reschedule"
          ? `/api/client/jobs/${actionJob.id}/reschedule-request`
          : `/api/client/jobs/${actionJob.id}/cancel-request`;
      const payload = actionMode === "reschedule" ? { requestedDate } : { reason: cancelReason };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Could not save request.");
      }
      toast({
        title: actionMode === "reschedule" ? "Date change request sent" : "Cancellation request sent",
        description: "Admin has been notified and will review it shortly.",
      });
      closeAction();
    } catch (error: any) {
      toast({
        title: "Request failed",
        description: error?.message ?? "Could not save request.",
        variant: "destructive",
      });
    } finally {
      setSubmittingAction(false);
    }
  }

  function renderJobCard(job: any) {
    const laundrySummary = buildLaundrySummary(job.laundryTask);
    const skipStatus = skipStatusFor(job);
    const isUpcomingActive =
      toDayKey(job.scheduledDate) >= currentDayKey && !["COMPLETED", "INVOICED"].includes(job.status);

    return (
      <Card key={job.id}>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
            <span className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                <ClipboardList className="h-4 w-4 text-primary" />
              </span>
              <span>
                {job.jobNumber ? `Job ${job.jobNumber}` : "Job"} - {job.jobType.replace(/_/g, " ")}
              </span>
            </span>
            <span className="rounded-full border px-2 py-1 text-xs font-medium">{job.status.replace(/_/g, " ")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Property</p>
              <p className="font-medium">{job.property.name}</p>
              <p className="text-xs text-muted-foreground">{job.property.suburb}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scheduled</p>
              <p className="font-medium">{format(toLocalDate(job.scheduledDate), "EEE dd MMM yyyy")}</p>
              <p className="text-xs text-muted-foreground">
                {job.startTime || "Time not set"}
                {job.dueTime ? ` - ${job.dueTime}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assignment</p>
              <p className="font-medium">{job.assignments.length > 0 ? "Assigned" : "Unassigned"}</p>
              {showCleanerNames && job.assignments.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {job.assignments.map((assignment: any) => assignment.user?.name || "Cleaner").join(", ")}
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Task requests</p>
              <p className="font-medium">{job.jobTasks.length} linked task(s)</p>
              <p className="text-xs text-muted-foreground">Client requests, carry-forwards, and approvals</p>
            </div>
          </div>

          {showLaundryUpdates && job.laundryTask ? (
            <div className="rounded-xl border border-border bg-muted/15 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Shirt className="h-4 w-4 text-primary" />
                    Laundry update
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Status {String(job.laundryTask.status).replace(/_/g, " ")} - Pickup{" "}
                    {format(toLocalDate(job.laundryTask.pickupDate), "dd MMM yyyy")} - Drop off{" "}
                    {format(toLocalDate(job.laundryTask.dropoffDate), "dd MMM yyyy")}
                  </p>
                  {laundrySummary ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-sm font-medium">{laundrySummary.title}</p>
                      <p className="text-xs text-muted-foreground">{laundrySummary.detail}</p>
                      {typeof laundrySummary.charge === "number" ? (
                        <p className="text-xs text-muted-foreground">
                          Recorded laundry charge: ${Number(laundrySummary.charge).toFixed(2)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/client/laundry?task=${job.laundryTask.id}&job=${job.id}`}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open full laundry job
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}

          {/* Skip-clean state banner */}
          {skipStatus === "SKIPPED" ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">Skipped — no clean</p>
              <p className="text-xs text-amber-800">
                This turnover has been marked as skipped and will not be cleaned.
                {job.cleanSkipReason ? ` Reason: ${job.cleanSkipReason}` : ""}
              </p>
            </div>
          ) : skipStatus === "REQUESTED" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="min-w-0">
                <p className="font-medium">Skip request pending</p>
                <p className="text-xs text-amber-800">
                  Waiting for admin to review your request to skip this clean.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={cancellingSkipId === job.id}
                onClick={() => cancelSkipRequest(job)}
              >
                {cancellingSkipId === job.id ? "Cancelling…" : "Cancel request"}
              </Button>
            </div>
          ) : skipStatus === "DECLINED" ? (
            <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Your previous skip request was declined — this clean will go ahead as scheduled.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/client/jobs/${job.id}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              View full details →
            </Link>
          </div>

          {showClientTaskRequests ? (
            <div className="flex flex-wrap justify-end gap-2">
              <ClientJobTaskRequestDialog
                jobId={job.id}
                jobLabel={`${job.property.name} - ${format(toLocalDate(job.scheduledDate), "dd MMM yyyy")}`}
              />
              {isUpcomingActive ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => openAction(job, "reschedule")}>
                    Change date
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openAction(job, "cancel")}>
                    Cancel
                  </Button>
                  {skipStatus === "NONE" || skipStatus === "DECLINED" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSkipJob(job);
                        setSkipReason("");
                      }}
                    >
                      Request to skip this clean
                    </Button>
                  ) : null}
                </>
              ) : null}
              {job.satisfactionRating ? (
                <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium">
                  You rated this {job.satisfactionRating.score}★
                </span>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          icon={<ClipboardList />}
          title="Jobs"
          description="Upcoming jobs first, with quick filters, direct task-request access, and linked laundry updates."
          className="flex-1"
        />
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              className="rounded-r-none rounded-l-lg"
              onClick={() => setViewMode("list")}
            >
              List
            </Button>
            <Button
              variant={viewMode === "calendar" ? "default" : "ghost"}
              className="rounded-l-none rounded-r-lg"
              onClick={() => setViewMode("calendar")}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              Calendar
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[
          { value: "all", label: "All" },
          { value: "today", label: "Today" },
          { value: "tomorrow", label: "Tomorrow" },
          { value: "week", label: "This week" },
        ].map((option) => (
          <Button
            key={option.value}
            variant={filterMode === option.value ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setFilterMode(option.value as FilterMode)}
          >
            {option.label}
          </Button>
        ))}
        <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-sm">
          <span className="text-muted-foreground">Pick date</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              setSelectedDate(event.target.value);
              setFilterMode(event.target.value ? "date" : "all");
              if (event.target.value) {
                setCalendarMonth(startOfMonth(new Date(`${event.target.value}T00:00:00`)));
              }
            }}
            className="bg-transparent outline-none"
          />
        </div>
      </div>

      {viewMode === "calendar" ? (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <Button variant="outline" size="icon" onClick={() => setCalendarMonth((current) => subMonths(current, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-sm font-medium">{format(calendarMonth, "MMMM yyyy")}</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setCalendarMonth(startOfMonth(toZonedTime(new Date(), TZ)))}>
                  Today
                </Button>
                <Button variant="outline" size="icon" onClick={() => setCalendarMonth((current) => addMonths(current, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                <div key={label}>{label}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((day) => {
                const dayKey = format(day, "yyyy-MM-dd");
                const isSelected = selectedDate === dayKey;
                const hasJobs = jobDayKeys.has(dayKey);
                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => {
                      setSelectedDate(dayKey);
                      setFilterMode("date");
                    }}
                    className={cn(
                      "relative rounded-xl border px-2 py-3 text-sm transition-colors",
                      isSameMonth(day, calendarMonth)
                        ? "border-border bg-surface hover:border-primary/40"
                        : "bg-muted/30 text-muted-foreground",
                      isSelected && "border-primary bg-primary/10 text-primary"
                    )}
                  >
                    <span>{format(day, "d")}</span>
                    {hasJobs ? (
                      <span className="absolute bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-4">
        {upcomingJobs.map((job) => renderJobCard(job))}

        {pastJobs.length > 0 ? (
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Past jobs</p>
                <Button variant="outline" onClick={() => setShowPastJobs((current) => !current)}>
                  {showPastJobs ? `Hide past jobs (${pastJobs.length})` : `Show past jobs (${pastJobs.length})`}
                </Button>
              </div>
              {showPastJobs ? <div className="space-y-4">{pastJobs.map((job) => renderJobCard(job))}</div> : null}
            </CardContent>
          </Card>
        ) : null}

        {filteredJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No jobs match the selected filter.
          </div>
        ) : null}
      </div>

      <Dialog open={Boolean(actionJob && actionMode)} onOpenChange={(open) => (!open ? closeAction() : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionMode === "reschedule" ? "Request a new date" : "Request cancellation"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">{actionJob?.property?.name}</p>
              <p className="text-muted-foreground">
                {actionJob ? format(toLocalDate(actionJob.scheduledDate), "EEE dd MMM yyyy") : ""}
              </p>
            </div>

            {actionMode === "reschedule" ? (
              <div className="space-y-1.5">
                <Label>Requested date</Label>
                <Input type="date" value={requestedDate} onChange={(event) => setRequestedDate(event.target.value)} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Select value={cancelReason} onValueChange={setCancelReason}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="slot change">Slot change</SelectItem>
                    <SelectItem value="no longer needed">No longer needed</SelectItem>
                    <SelectItem value="found another cleaner">Found another cleaner</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeAction} disabled={submittingAction}>
                Close
              </Button>
              <Button onClick={submitAction} disabled={submittingAction || (actionMode === "reschedule" && !requestedDate)}>
                {submittingAction ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquareMore className="mr-2 h-4 w-4" />
                )}
                Send request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(skipJob)} onOpenChange={(open) => (!open ? setSkipJob(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request to skip this clean</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">{skipJob?.property?.name}</p>
              <p className="text-muted-foreground">
                {skipJob ? format(toLocalDate(skipJob.scheduledDate), "EEE dd MMM yyyy") : ""}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              We will not clean this turnover if admin approves your request. You can cancel the
              request any time before it is reviewed.
            </p>
            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Input
                value={skipReason}
                onChange={(event) => setSkipReason(event.target.value)}
                placeholder="e.g. no guest this turnover"
                maxLength={500}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSkipJob(null)} disabled={submittingSkip}>
                Close
              </Button>
              <Button onClick={submitSkipRequest} disabled={submittingSkip}>
                {submittingSkip ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquareMore className="mr-2 h-4 w-4" />
                )}
                Send skip request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
