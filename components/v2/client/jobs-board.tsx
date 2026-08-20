"use client";

/**
 * Estate client jobs board — Upcoming/Past groups, search + status filter,
 * per-job actions wired to the SAME endpoints the legacy client workspace uses:
 *   POST   /api/client/jobs/[id]/skip-request        { reason? }
 *   DELETE /api/client/jobs/[id]/skip-request
 *   POST   /api/client/jobs/[id]/reschedule-request  { requestedDate }
 *   POST   /api/client/jobs/[id]/cancel-request      { reason }
 *   POST   /api/client/jobs/[id]/task-requests       { title, description?, requiresPhoto, requiresNote, attachmentKeys }
 */
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
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Search,
  Shirt,
  Star,
  Upload,
  User,
  X,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import { ECheckTile, EInlineNotice, EInput, ELabel, ESelect, ETextarea } from "@/components/v2/client/fields";
import { cn } from "@/lib/utils";

const TZ = "Australia/Sydney";
const STORAGE_KEY = "sneek_client_jobs_filter";

type FilterMode = "all" | "today" | "tomorrow" | "week" | "date";
type ViewMode = "list" | "calendar";

type JobRow = {
  id: string;
  jobNumber: string | null;
  jobType: string;
  status: string;
  scheduledDate: Date | string;
  startTime: string | null;
  dueTime: string | null;
  cleanSkipStatus?: string | null;
  cleanSkipReason?: string | null;
  property: { id: string; name: string; suburb: string | null };
  assignments: Array<{ user: { id: string; name: string | null } | null }>;
  jobTasks: Array<{ id: string }>;
  laundryTask: { id: string; status: string } | null;
  satisfactionRating: { score: number } | null;
};

type PanelMode = "task" | "reschedule" | "cancel" | "skip" | null;

const CANCEL_REASONS = ["slot change", "no longer needed", "found another cleaner", "other"];

function toLocal(value: Date | string) {
  return toZonedTime(new Date(value), TZ);
}
function dayKey(value: Date | string) {
  return format(toLocal(value), "yyyy-MM-dd");
}
function titleCase(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function todayKeyOf() {
  return format(toZonedTime(new Date(), TZ), "yyyy-MM-dd");
}
function tomorrowKeyOf() {
  const base = toZonedTime(new Date(), TZ);
  return format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1), "yyyy-MM-dd");
}
function withinNextWeek(value: Date | string) {
  const today = new Date(`${todayKeyOf()}T00:00:00`);
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  const current = new Date(`${dayKey(value)}T00:00:00`);
  return current >= today && current <= end;
}
function matchesFilter(job: JobRow, mode: FilterMode, selectedDate: string) {
  const key = dayKey(job.scheduledDate);
  if (mode === "today") return key === todayKeyOf();
  if (mode === "tomorrow") return key === tomorrowKeyOf();
  if (mode === "week") return withinNextWeek(job.scheduledDate);
  if (mode === "date") return selectedDate ? key === selectedDate : true;
  return true;
}

type UploadedAttachment = { key: string; url: string; label: string };

async function uploadTaskRequestFile(file: File): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "client-job-task-requests");
  const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Could not upload file.");
  }
  return { key: String(body.key), url: String(body.url), label: file.name };
}
function statusTone(status: string): "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "COMPLETED":
    case "INVOICED":
      return "success";
    case "IN_PROGRESS":
    case "SUBMITTED":
    case "QA_REVIEW":
      return "gold";
    case "UNASSIGNED":
    case "OFFERED":
      return "warning";
    case "CANCELLED":
      return "danger";
    default:
      return "primary";
  }
}

function JobActionPanel({
  job,
  mode,
  onClose,
  onSkipChange,
}: {
  job: JobRow;
  mode: Exclude<PanelMode, null>;
  onClose: () => void;
  onSkipChange: (next: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // task request fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [requiresNote, setRequiresNote] = useState(false);
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // reschedule / cancel / skip fields
  const [requestedDate, setRequestedDate] = useState(dayKey(job.scheduledDate));
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0]);
  const [skipReason, setSkipReason] = useState("");

  async function post(url: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send the request.");
      return true;
    } catch (err: any) {
      setError(err?.message ?? "Could not send the request.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (mode === "task") {
      if (!title.trim()) {
        setError("A task title is required.");
        return;
      }
      const ok = await post(`/api/client/jobs/${job.id}/task-requests`, {
        title: title.trim(),
        description: description.trim() || undefined,
        requiresPhoto,
        requiresNote,
        attachmentKeys: attachments.map((item) => item.key),
      });
      if (ok) {
        setDone("Task request submitted — admin review happens before it reaches the cleaners.");
        router.refresh();
      }
    } else if (mode === "reschedule") {
      if (!requestedDate) {
        setError("Pick a requested date first.");
        return;
      }
      const ok = await post(`/api/client/jobs/${job.id}/reschedule-request`, { requestedDate });
      if (ok) setDone("Date change request sent — the team will confirm shortly.");
    } else if (mode === "cancel") {
      const ok = await post(`/api/client/jobs/${job.id}/cancel-request`, { reason: cancelReason });
      if (ok) setDone("Cancellation request sent — the team has been notified.");
    } else if (mode === "skip") {
      const ok = await post(`/api/client/jobs/${job.id}/skip-request`, {
        reason: skipReason.trim() || undefined,
      });
      if (ok) {
        onSkipChange("REQUESTED");
        setDone("Skip request sent — you can withdraw it until it is reviewed.");
        router.refresh();
      }
    }
  }

  const heading =
    mode === "task"
      ? "Request a special task"
      : mode === "reschedule"
        ? "Request a new date"
        : mode === "cancel"
          ? "Request cancellation"
          : "Request to skip this clean";

  return (
    <div className="mt-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
      <div className="flex items-start justify-between gap-3">
        <EEyebrow>{heading}</EEyebrow>
        <button
          type="button"
          onClick={onClose}
          className="text-[0.75rem] font-medium text-[hsl(var(--e-text-faint))] hover:text-[hsl(var(--e-foreground))]"
        >
          Close
        </button>
      </div>

      {done ? (
        <EInlineNotice tone="success" className="mt-3">
          {done}
        </EInlineNotice>
      ) : (
        <div className="mt-3 space-y-3">
          {mode === "task" ? (
            <>
              <div className="space-y-1.5">
                <ELabel htmlFor={`task-title-${job.id}`}>Task title</ELabel>
                <EInput
                  id={`task-title-${job.id}`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Wipe down balcony glass"
                />
              </div>
              <div className="space-y-1.5">
                <ELabel htmlFor={`task-desc-${job.id}`}>Instructions</ELabel>
                <ETextarea
                  id={`task-desc-${job.id}`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the request clearly for the review team and cleaners."
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <ECheckTile checked={requiresPhoto} onChange={setRequiresPhoto}>
                  Require photo proof
                </ECheckTile>
                <ECheckTile checked={requiresNote} onChange={setRequiresNote}>
                  Require cleaner note
                </ECheckTile>
              </div>
              <div className="space-y-1.5">
                <ELabel htmlFor={`task-files-${job.id}`}>Reference files</ELabel>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] px-3 py-2.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] transition-colors hover:border-[hsl(var(--e-gold))]",
                    uploading && "pointer-events-none opacity-60"
                  )}
                >
                  <Upload className="h-4 w-4" />
                  <span>{uploading ? "Uploading…" : "Upload image or video references"}</span>
                  <input
                    id={`task-files-${job.id}`}
                    type="file"
                    className="hidden"
                    accept="image/*,video/*"
                    multiple
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files?.length) return;
                      setUploading(true);
                      setError(null);
                      try {
                        const uploaded: UploadedAttachment[] = [];
                        for (const file of Array.from(files)) {
                          uploaded.push(await uploadTaskRequestFile(file));
                        }
                        setAttachments((prev) => [...prev, ...uploaded]);
                      } catch (err: any) {
                        setError(err?.message ?? "Could not upload files.");
                      } finally {
                        setUploading(false);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
                {attachments.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {attachments.map((item) => (
                      <span
                        key={item.key}
                        className="group relative inline-flex items-center gap-1.5 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] py-1 pl-1 pr-2 text-[0.75rem]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.url}
                          alt={item.label}
                          className="h-8 w-8 rounded-[3px] object-cover"
                        />
                        <span className="max-w-[8rem] truncate text-[hsl(var(--e-text-secondary))]">
                          {item.label}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${item.label}`}
                          onClick={() =>
                            setAttachments((prev) => prev.filter((a) => a.key !== item.key))
                          }
                          className="text-[hsl(var(--e-text-faint))] hover:text-[hsl(var(--e-danger))]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {mode === "reschedule" ? (
            <div className="space-y-1.5">
              <ELabel htmlFor={`resched-${job.id}`}>Requested date</ELabel>
              <EInput
                id={`resched-${job.id}`}
                type="date"
                value={requestedDate}
                onChange={(e) => setRequestedDate(e.target.value)}
              />
            </div>
          ) : null}

          {mode === "cancel" ? (
            <div className="space-y-1.5">
              <ELabel htmlFor={`cancel-${job.id}`}>Reason</ELabel>
              <ESelect
                id={`cancel-${job.id}`}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              >
                {CANCEL_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {titleCase(reason.replace(/ /g, "_"))}
                  </option>
                ))}
              </ESelect>
            </div>
          ) : null}

          {mode === "skip" ? (
            <>
              <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                We will not clean this turnover if the team approves your request. You can withdraw
                it any time before it is reviewed.
              </p>
              <div className="space-y-1.5">
                <ELabel htmlFor={`skip-${job.id}`}>Reason (optional)</ELabel>
                <EInput
                  id={`skip-${job.id}`}
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  placeholder="e.g. no guest this turnover"
                  maxLength={500}
                />
              </div>
            </>
          ) : null}

          {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}

          <div className="flex justify-end gap-2 pt-1">
            <EButton variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={submit} disabled={busy || uploading}>
              {busy ? "Sending…" : "Send request"}
            </EButton>
          </div>
        </div>
      )}
    </div>
  );
}

function JobCard({
  job,
  showCleanerNames,
  showClientTaskRequests,
  showLaundryUpdates,
  isUpcoming,
}: {
  job: JobRow;
  showCleanerNames: boolean;
  showClientTaskRequests: boolean;
  showLaundryUpdates: boolean;
  isUpcoming: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelMode>(null);
  const [skipOverride, setSkipOverride] = useState<string | null>(null);
  const [skipBusy, setSkipBusy] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);

  const skipStatus = skipOverride ?? job.cleanSkipStatus ?? "NONE";
  const local = toLocal(job.scheduledDate);
  const cleaners = showCleanerNames
    ? job.assignments.map((a) => a.user?.name).filter(Boolean).join(", ")
    : null;
  const actionable =
    isUpcoming && !["COMPLETED", "INVOICED", "CANCELLED"].includes(job.status);

  async function withdrawSkip() {
    setSkipBusy(true);
    setSkipError(null);
    try {
      const res = await fetch(`/api/client/jobs/${job.id}/skip-request`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not withdraw the skip request.");
      setSkipOverride("NONE");
      router.refresh();
    } catch (err: any) {
      setSkipError(err?.message ?? "Could not withdraw the skip request.");
    } finally {
      setSkipBusy(false);
    }
  }

  return (
    <ECard className={cn(!isUpcoming && "opacity-90")}>
      <ECardBody className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Serif date block */}
          <div className="flex items-start gap-4">
            <div className="w-14 shrink-0 border-r border-[hsl(var(--e-border))] pr-4 text-center">
              <p className="e-numeral text-[1.625rem] leading-none">{format(local, "d")}</p>
              <p className="mt-1 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-gold-ink))]">
                {format(local, "MMM")}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold leading-tight">{job.property.name}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                <MapPin className="h-3 w-3" />
                {job.property.suburb || "—"} · {titleCase(job.jobType)}
              </p>
              <p className="mt-1 flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                <CalendarClock className="h-3 w-3" />
                {format(local, "EEEE d MMMM yyyy")}
                {job.startTime ? ` · ${job.startTime}${job.dueTime ? ` – ${job.dueTime}` : ""}` : ""}
              </p>
              {cleaners ? (
                <p className="mt-1 flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  <User className="h-3 w-3" /> {cleaners}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <EBadge tone={statusTone(job.status)} soft>
              {titleCase(job.status)}
            </EBadge>
            {job.jobNumber ? (
              <span className="text-[0.6875rem] tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                Nº {job.jobNumber}
              </span>
            ) : null}
            {job.satisfactionRating ? (
              <span className="flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-gold-ink))]">
                <Star className="h-3 w-3 fill-current" /> Rated {job.satisfactionRating.score}
              </span>
            ) : null}
          </div>
        </div>

        {showLaundryUpdates && job.laundryTask ? (
          <p className="mt-3 flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            <Shirt className="h-3.5 w-3.5 text-[hsl(var(--e-accent-portal))]" />
            Linked laundry — {titleCase(job.laundryTask.status)}
            <Link
              href={`/v2/client/laundry?task=${job.laundryTask.id}&job=${job.id}`}
              className="font-medium text-[hsl(var(--e-gold-ink))] hover:underline"
            >
              View
            </Link>
          </p>
        ) : null}

        {/* Skip state */}
        {skipStatus === "SKIPPED" ? (
          <div className="mt-3 rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
            <span className="font-semibold">Skipped — no clean.</span>{" "}
            {job.cleanSkipReason ? `Reason: ${job.cleanSkipReason}` : "This turnover will not be cleaned."}
          </div>
        ) : skipStatus === "REQUESTED" ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
            <span>
              <span className="font-semibold">Skip request pending</span> — awaiting review.
            </span>
            <EButton variant="outline" size="sm" onClick={withdrawSkip} disabled={skipBusy}>
              {skipBusy ? "Withdrawing…" : "Withdraw"}
            </EButton>
          </div>
        ) : skipStatus === "DECLINED" ? (
          <p className="mt-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            A previous skip request was declined — this clean goes ahead as scheduled.
          </p>
        ) : null}
        {skipError ? <EInlineNotice tone="danger" className="mt-2">{skipError}</EInlineNotice> : null}

        <EThread className="my-4" />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {showClientTaskRequests && actionable ? (
              <>
                <EButton variant="outline" size="sm" onClick={() => setPanel(panel === "task" ? null : "task")}>
                  Request task
                </EButton>
                <EButton
                  variant="outline"
                  size="sm"
                  onClick={() => setPanel(panel === "reschedule" ? null : "reschedule")}
                >
                  Change date
                </EButton>
                <EButton variant="outline" size="sm" onClick={() => setPanel(panel === "cancel" ? null : "cancel")}>
                  Cancel
                </EButton>
                {skipStatus === "NONE" || skipStatus === "DECLINED" ? (
                  <EButton variant="outline" size="sm" onClick={() => setPanel(panel === "skip" ? null : "skip")}>
                    Skip this clean
                  </EButton>
                ) : null}
              </>
            ) : null}
          </div>
          <EButton asChild variant="ghost" size="sm">
            <Link href={`/v2/client/jobs/${job.id}`}>
              Details <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </EButton>
        </div>

        {panel ? (
          <JobActionPanel
            key={panel}
            job={job}
            mode={panel}
            onClose={() => setPanel(null)}
            onSkipChange={(next) => setSkipOverride(next)}
          />
        ) : null}
      </ECardBody>
    </ECard>
  );
}

export function ClientJobsBoard({
  jobs,
  showCleanerNames,
  showClientTaskRequests,
  showLaundryUpdates,
}: {
  jobs: JobRow[];
  showCleanerNames: boolean;
  showClientTaskRequests: boolean;
  showLaundryUpdates: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [showPast, setShowPast] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  // Admin-side parity: narrow by property, job type and an explicit date range.
  const [propertyId, setPropertyId] = useState("ALL");
  const [jobType, setJobType] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() =>
    startOfMonth(toZonedTime(new Date(), TZ))
  );

  // Restore the last-used filter/view (same key as the legacy workspace so
  // preferences carry across the redesign).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        filterMode?: FilterMode;
        selectedDate?: string;
        viewMode?: ViewMode;
      };
      if (parsed.filterMode) setFilterMode(parsed.filterMode);
      if (parsed.selectedDate) setSelectedDate(parsed.selectedDate);
      if (parsed.viewMode) setViewMode(parsed.viewMode);
    } catch {
      // ignore invalid local state
    }
  }, []);

  useEffect(() => {
    // Guarded like the read above it. localStorage throws in private-mode
    // Safari and when the quota is full, and an unwritable preference must
    // never take the jobs list down with it.
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ filterMode, selectedDate, viewMode })
      );
    } catch {
      // The board keeps working; it just will not remember this choice.
    }
  }, [filterMode, selectedDate, viewMode]);

  const statuses = useMemo(
    () => Array.from(new Set(jobs.map((job) => job.status))).sort(),
    [jobs]
  );

  const todayKey = format(toZonedTime(new Date(), TZ), "yyyy-MM-dd");

  const jobDayKeys = useMemo(
    () => new Set(jobs.map((job) => dayKey(job.scheduledDate))),
    [jobs]
  );
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(calendarMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(calendarMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [calendarMonth]);

  const properties = useMemo(() => {
    const seen = new Map<string, string>();
    for (const job of jobs) {
      const id = job.property.id ?? job.property.name;
      if (id && !seen.has(id)) seen.set(id, job.property.name);
    }
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [jobs]);

  const jobTypes = useMemo(
    () => Array.from(new Set(jobs.map((job) => job.jobType))).sort(),
    [jobs]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (!matchesFilter(job, filterMode, selectedDate)) return false;
      if (status !== "ALL" && job.status !== status) return false;
      if (propertyId !== "ALL" && (job.property.id ?? job.property.name) !== propertyId) return false;
      if (jobType !== "ALL" && job.jobType !== jobType) return false;
      // Explicit range, inclusive at both ends; either bound may stand alone.
      const key = dayKey(job.scheduledDate);
      if (fromDate && key < fromDate) return false;
      if (toDate && key > toDate) return false;
      if (!q) return true;
      return [job.property.name, job.property.suburb ?? "", job.jobNumber ?? "", titleCase(job.jobType)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [jobs, query, status, filterMode, selectedDate, propertyId, jobType, fromDate, toDate]);

  // Every narrowing control in one place, so an active filter is always
  // visible and clearable. The board restores the last-used filter from
  // localStorage, which previously meant a client who once picked "Today"
  // saw only today's jobs on every later visit with nothing on screen
  // explaining why the list looked empty.
  const activeFilters = useMemo(() => {
    const chips: Array<{ label: string; clear: () => void }> = [];
    if (filterMode !== "all")
      chips.push({
        label: filterMode === "date" ? `Date: ${selectedDate}` : `Quick filter: ${titleCase(filterMode)}`,
        clear: () => {
          setFilterMode("all");
          setSelectedDate("");
        },
      });
    if (status !== "ALL") chips.push({ label: `Status: ${titleCase(status)}`, clear: () => setStatus("ALL") });
    if (propertyId !== "ALL")
      chips.push({
        label: `Property: ${properties.find((p) => p.id === propertyId)?.name ?? propertyId}`,
        clear: () => setPropertyId("ALL"),
      });
    if (jobType !== "ALL") chips.push({ label: `Type: ${titleCase(jobType)}`, clear: () => setJobType("ALL") });
    if (fromDate) chips.push({ label: `From ${fromDate}`, clear: () => setFromDate("") });
    if (toDate) chips.push({ label: `To ${toDate}`, clear: () => setToDate("") });
    if (query.trim()) chips.push({ label: `Search: "${query.trim()}"`, clear: () => setQuery("") });
    return chips;
  }, [filterMode, selectedDate, status, propertyId, jobType, fromDate, toDate, query, properties]);

  function clearAllFilters() {
    setFilterMode("all");
    setSelectedDate("");
    setStatus("ALL");
    setPropertyId("ALL");
    setJobType("ALL");
    setFromDate("");
    setToDate("");
    setQuery("");
  }

  const upcoming = useMemo(
    () =>
      filtered
        .filter((job) => dayKey(job.scheduledDate) >= todayKey)
        .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()),
    [filtered, todayKey]
  );
  const past = useMemo(
    () =>
      filtered
        .filter((job) => dayKey(job.scheduledDate) < todayKey)
        .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime()),
    [filtered, todayKey]
  );

  // When the only matches are in the past, open that section rather than
  // leaving the client staring at an empty Upcoming list behind a collapsed
  // "Show (N)". Only forces it open — a client who then collapses it manually
  // is not fought with, because this runs on the emptiness of Upcoming, not on
  // every render.
  useEffect(() => {
    if (upcoming.length === 0 && past.length > 0) setShowPast(true);
  }, [upcoming.length, past.length]);

  return (
    <div className="space-y-8">
      {/* Search + status filter + view toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
          <EInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search property, suburb, or job number"
            className="pl-9"
            aria-label="Search jobs"
          />
        </div>
        <ESelect
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-auto min-w-[160px]"
          aria-label="Filter by status"
        >
          <option value="ALL">All statuses</option>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </ESelect>
        <div className="flex overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))]">
          {(
            [
              { value: "list", label: "List", icon: null },
              { value: "calendar", label: "Calendar", icon: <CalendarDays className="h-3.5 w-3.5" /> },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setViewMode(option.value)}
              aria-pressed={viewMode === option.value}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 px-4 text-[0.8125rem] font-[550] transition-colors duration-[160ms]",
                viewMode === option.value
                  ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                  : "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]"
              )}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Property / type / explicit date range — admin-side parity */}
      <div className="flex flex-wrap items-end gap-3">
        <ESelect
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className="w-auto min-w-[180px]"
          aria-label="Filter by property"
        >
          <option value="ALL">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </ESelect>
        <ESelect
          value={jobType}
          onChange={(e) => setJobType(e.target.value)}
          className="w-auto min-w-[170px]"
          aria-label="Filter by job type"
        >
          <option value="ALL">All job types</option>
          {jobTypes.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </ESelect>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">From</span>
          <EInput
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-[10.5rem]"
            aria-label="From date"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">To</span>
          <EInput
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-[10.5rem]"
            aria-label="To date"
          />
        </label>
      </div>

      {/* Active filters — never let a restored filter hide jobs silently. */}
      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-2))] px-3 py-2">
          <span className="text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">
            Showing {filtered.length} of {jobs.length} jobs ·
          </span>
          {activeFilters.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.clear}
              className="inline-flex items-center gap-1 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 py-1 text-[0.75rem] hover:bg-[hsl(var(--e-muted))]"
            >
              {chip.label} <span aria-hidden>×</span>
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {/* Quick date filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { value: "all", label: "All" },
            { value: "today", label: "Today" },
            { value: "tomorrow", label: "Tomorrow" },
            { value: "week", label: "This week" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setFilterMode(option.value);
              setSelectedDate("");
            }}
            aria-pressed={filterMode === option.value}
            className={cn(
              "rounded-[var(--e-radius-pill)] border px-3.5 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms]",
              filterMode === option.value
                ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]"
            )}
          >
            {option.label}
          </button>
        ))}
        <label className="flex items-center gap-2 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3.5 py-1.5 text-[0.8125rem]">
          <span className="text-[hsl(var(--e-muted-foreground))]">Pick date</span>
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
            className="bg-transparent text-[hsl(var(--e-foreground))] outline-none"
            aria-label="Filter by date"
          />
        </label>
      </div>

      {/* Calendar view */}
      {viewMode === "calendar" ? (
        <ECard>
          <ECardBody className="space-y-4 pt-5">
            <div className="flex items-center justify-between">
              <EButton
                variant="outline"
                size="icon"
                aria-label="Previous month"
                onClick={() => setCalendarMonth((current) => subMonths(current, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </EButton>
              <p className="e-display-sm text-[1.0625rem]">{format(calendarMonth, "MMMM yyyy")}</p>
              <div className="flex items-center gap-2">
                <EButton
                  variant="outline"
                  size="sm"
                  onClick={() => setCalendarMonth(startOfMonth(toZonedTime(new Date(), TZ)))}
                >
                  Today
                </EButton>
                <EButton
                  variant="outline"
                  size="icon"
                  aria-label="Next month"
                  onClick={() => setCalendarMonth((current) => addMonths(current, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </EButton>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-2 text-center text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                <div key={label}>{label}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const isSelected = selectedDate === key;
                const hasJobs = jobDayKeys.has(key);
                const inMonth = isSameMonth(day, calendarMonth);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedDate(key);
                      setFilterMode("date");
                    }}
                    className={cn(
                      "relative rounded-[var(--e-radius)] border px-2 py-3 text-[0.875rem] transition-colors duration-[160ms]",
                      inMonth
                        ? "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-gold))]"
                        : "border-transparent bg-[hsl(var(--e-surface-sunken))] text-[hsl(var(--e-text-faint))]",
                      isSelected &&
                        "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-accent-portal-soft))] text-[hsl(var(--e-foreground))]"
                    )}
                  >
                    <span className={cn(hasJobs && inMonth && "font-semibold")}>{format(day, "d")}</span>
                    {hasJobs ? (
                      <span className="absolute bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[hsl(var(--e-gold))]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Upcoming */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <EEyebrow>Upcoming</EEyebrow>
          <span className="e-numeral text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
            {upcoming.length}
          </span>
        </div>
        {upcoming.length === 0 ? (
          <EEmptyState
            eyebrow="All quiet"
            title="No upcoming services match"
            description={
              // Filtering to a past date emptied Upcoming while the matches sat
              // inside the collapsed Past section, so the board looked broken.
              // Say where they went; the section below also auto-opens.
              past.length > 0
                ? `No upcoming services match, but ${past.length} past ${past.length === 1 ? "service does" : "services do"} — see Past services below.`
                : "Adjust the filters, or book a clean to see it appear here."
            }
          />
        ) : (
          <div className="space-y-3">
            {upcoming.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                showCleanerNames={showCleanerNames}
                showClientTaskRequests={showClientTaskRequests}
                showLaundryUpdates={showLaundryUpdates}
                isUpcoming
              />
            ))}
          </div>
        )}
      </section>

      {/* Past */}
      {past.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <EEyebrow>Past services</EEyebrow>
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className="text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))] hover:underline"
            >
              {showPast ? `Hide (${past.length})` : `Show (${past.length})`}
            </button>
          </div>
          {showPast ? (
            <div className="space-y-3">
              {past.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  showCleanerNames={showCleanerNames}
                  showClientTaskRequests={showClientTaskRequests}
                  showLaundryUpdates={showLaundryUpdates}
                  isUpcoming={false}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
