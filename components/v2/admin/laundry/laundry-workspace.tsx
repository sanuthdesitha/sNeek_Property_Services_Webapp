"use client";
import { JobStatusIcon } from "@/components/shared/job-status-icon";


import { useRestorableState } from "@/hooks/use-restorable-state";

/**
 * ESTATE admin laundry workspace — the real v2-native operations surface. A
 * tabbed Estate shell over the existing laundry data layer:
 *   • Today     — today + upcoming task cards; row opens the edit dialog
 *                 (PATCH /api/admin/laundry/[id]); "New run" wired to generate-week.
 *   • Live      — LaundryRouteMap + in-transit / overdue cards (/api/admin/laundry/live).
 *   • Completed — delivered/skipped history with MediaGallery evidence overlays.
 *   • Reports   — filters + Preview / Download / Email + history (invoice endpoints).
 *   • Suppliers — the existing v2 supplier manager.
 * Data for Today + Completed comes from GET /api/laundry/week (rich task feed).
 * No components/ui/*; Estate token scope only.
 */
import * as React from "react";
import { format } from "date-fns";
import {
  addDaysToKey,
  sydneyDayStart,
  sydneyDateKey,
  sydneyTodayKey,
} from "@/lib/time/sydney-range";
import { describeLaundryConfirmation } from "@/lib/laundry/media";
import { statusBlockStyle } from "@/lib/jobs/status-presentation";
import { toZonedTime } from "date-fns-tz";
import {
  ClipboardList,
  BarChart3,
  Images,
  PackageCheck,
  Pencil,
  Radio,
  Scale,
  Shirt,
  Store,
  Trash2,
  Truck,
  Weight,
} from "lucide-react";
import Link from "next/link";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { toast } from "@/hooks/use-toast";
import {
  useLaundryDeleteDialog,
  type LaundryDeletePayload,
} from "@/components/v2/laundry/laundry-delete-dialog";
import { MediaGallery } from "@/components/shared/media-gallery";
import { LaundrySuppliers } from "@/components/v2/admin/laundry/laundry-suppliers";
import { LaundryEditDialog } from "./laundry-edit-dialog";
import { LaundryLive } from "./laundry-live";
import { LaundryEvidenceReplacement } from "./laundry-evidence-replacement";
import { LaundryReports } from "./laundry-reports";
import { LaundryNewRun } from "./laundry-new-run";
import { LaundryInvestigation } from "./laundry-investigation";
import {
  buildTaskMedia,
  isCompleted,
  mediaCount,
  statusLabel,
  statusTone,
  type LaundryTaskDTO,
} from "./laundry-shared";

const TZ = "Australia/Sydney";

type TabKey =
  | "investigate"
  | "today"
  | "live"
  | "completed"
  | "reports"
  | "suppliers";

function propertyLine(task: LaundryTaskDTO) {
  const name = task.property?.name ?? "Property";
  const suburb = task.property?.suburb ?? "";
  return { name, suburb };
}

/* ── Tab bar (client-state, Estate segmented control) ───────────────────── */
function TabBar({
  active,
  onSelect,
  tabs,
}: {
  active: TabKey;
  onSelect: (key: TabKey) => void;
  tabs: Array<{
    key: TabKey;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }>;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex min-w-full items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelect(tab.key)}
              className={
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] tracking-[0.01em] transition-colors duration-[160ms] " +
                (isActive
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {tab.icon}
              {tab.label}
              {typeof tab.count === "number" ? (
                <span
                  className={
                    "e-tnum rounded-[var(--e-radius-pill)] px-1.5 text-[0.6875rem] " +
                    (isActive
                      ? "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                      : "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]")
                  }
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Task card (Today + Completed share this row) ───────────────────────── */
function TaskCard({
  task,
  onEdit,
  onDelete,
  onReport,
  onSaved,
  busy,
  showMedia,
}: {
  task: LaundryTaskDTO;
  onEdit: (task: LaundryTaskDTO) => void;
  onDelete: (task: LaundryTaskDTO) => void;
  onReport: (task: LaundryTaskDTO) => void;
  onSaved: () => void;
  busy?: boolean;
  showMedia?: boolean;
}) {
  const { name, suburb } = propertyLine(task);
  const clientName =
    task.property?.client?.name ?? task.property?.client?.email ?? null;
  const supplier = task.supplier?.name ?? null;
  const media = showMedia ? buildTaskMedia(task) : [];
  const count = mediaCount(task);

  return (
    <ECard style={statusBlockStyle(task.status, "laundry")}>
      <span className="float-left m-3"><JobStatusIcon status={task.status} domain="laundry" /></span>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          <div className="min-w-0 flex-1">
            <p className="break-words text-[0.9375rem] font-[550]">
              {name}
              {suburb ? (
                <span className="font-normal text-[hsl(var(--e-muted-foreground))]">
                  , {suburb}
                </span>
              ) : null}
            </p>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {clientName ?? "Unassigned client"}
              {supplier ? ` · ${supplier}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              <span className="inline-flex items-center gap-1">
                <Truck className="h-3 w-3" /> Pickup{" "}
                {format(
                  toZonedTime(new Date(task.pickupDate), TZ),
                  "EEE d MMM",
                )}
              </span>
              <span className="inline-flex items-center gap-1">
                <PackageCheck className="h-3 w-3" /> Drop-off{" "}
                {format(
                  toZonedTime(new Date(task.dropoffDate), TZ),
                  "EEE d MMM",
                )}
              </span>
              <span className="inline-flex items-center gap-1">
                <Weight className="h-3 w-3" />{" "}
                {task.bagWeightKg ? `${task.bagWeightKg} kg` : "Weight t.b.c."}
              </span>
              {count > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Images className="h-3 w-3" /> {count} photo
                  {count === 1 ? "" : "s"}
                </span>
              ) : null}
              {task.dropoffCostAud != null ? (
                <span className="e-tnum inline-flex items-center gap-1 text-[hsl(var(--e-gold-ink))]">
                  ${Number(task.dropoffCostAud).toFixed(2)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end">
            <EBadge tone={statusTone(task.status)} soft>
              {statusLabel(task.status)}
            </EBadge>
            <div className="flex items-center gap-1.5">
              <EButton variant="outline" size="sm" onClick={() => onEdit(task)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </EButton>
              <EButton
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={`Delete the laundry set for ${name}`}
                onClick={() => onDelete(task)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </EButton>
            </div>
          </div>
        </div>

        {task.flagNotes ? (
          <p className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] px-2.5 py-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            {task.flagNotes}
          </p>
        ) : null}

        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Handoff and job details
          </summary>
          <div className="mt-2 space-y-2">
            <EButton variant="outline" size="sm" onClick={() => onReport(task)}>
              Task report / PDF
            </EButton>
            {task.property?.linenBufferSets != null && (
              <p>Buffer linen: {task.property.linenBufferSets} sets</p>
            )}
            {task.property?.keyLostMode && (
              <p>Key lost — same-day pickup and delivery required.</p>
            )}
            {task.confirmations
              ?.filter((row) => row.photoUrl)
              .map((row) => (
                <LaundryEvidenceReplacement
                  key={row.id}
                  confirmationId={row.id}
                  onSaved={onSaved}
                />
              ))}
            {task.property?.address && <p>{task.property.address}</p>}
            {task.job?.scheduledDate && (
              <p>
                Cleaning:{" "}
                {format(
                  toZonedTime(new Date(task.job.scheduledDate), TZ),
                  "EEE d MMM",
                )}{" "}
                · {task.job.status?.replace(/_/g, " ")}
              </p>
            )}
            {task.jobId && (
              <Link className="underline" href={`/v2/admin/jobs/${task.jobId}`}>
                Open linked job
              </Link>
            )}
            {task.confirmations?.map((row) => (
              <p key={row.id}>
                {row.confirmedByName ?? "Team member"}:{" "}
                {row.laundryReady === false
                  ? "Not ready"
                  : row.laundryReady === true
                    ? "Ready"
                    : "Handoff recorded"}
                {row.bagLocation ? ` · ${row.bagLocation}` : ""}
                {describeLaundryConfirmation(row)
                  ? ` · ${describeLaundryConfirmation(row)}`
                  : ""}
              </p>
            ))}
            {!task.confirmations?.length && (
              <p>No handoff confirmation recorded.</p>
            )}
            {task.flagReason && (
              <p>Flag: {task.flagReason.replace(/_/g, " ")}</p>
            )}
            {task.skipReasonCode && (
              <p>
                Skipped: {task.skipReasonCode.replace(/_/g, " ")}{" "}
                {task.skipReasonNote}
              </p>
            )}
            {task.adminOverrideNote && (
              <p>Override: {task.adminOverrideNote}</p>
            )}
            {[
              ["Confirmed", task.confirmedAt],
              ["Picked up", task.pickedUpAt],
              ["Delivered", task.droppedAt],
            ].map(([label, value]) =>
              value ? (
                <p key={label}>
                  {label}:{" "}
                  {format(toZonedTime(new Date(value), TZ), "d MMM yyyy HH:mm")}
                </p>
              ) : null,
            )}
          </div>
        </details>
        {showMedia && media.length > 0 ? (
          <div className="border-t border-[hsl(var(--e-border))] pt-3">
            <p className="e-eyebrow mb-1.5">Evidence</p>
            <MediaGallery
              items={media}
              title="Laundry evidence"
              className="grid grid-cols-3 gap-2 sm:grid-cols-5"
            />
          </div>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

export function LaundryWorkspace({
  canReviewBags = false,
}: {
  canReviewBags?: boolean;
}) {
  const [tab, setTab] = useRestorableState<TabKey>(
    "laundry-workspace:tab",
    "today",
  );
  const [reportTask, setReportTask] = useRestorableState<{
    id: string;
    name: string;
  } | null>("admin-laundry:report-task", null);
  const [tasks, setTasks] = React.useState<LaundryTaskDTO[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [search, setSearch] = useRestorableState("admin-laundry:search", "");
  const [status, setStatus] = useRestorableState("admin-laundry:status", "all");
  const [startDate, setStartDate] = useRestorableState(
    "admin-laundry:start",
    addDaysToKey(sydneyTodayKey(), -14),
  );
  const [endDate, setEndDate] = useRestorableState(
    "admin-laundry:end",
    addDaysToKey(sydneyTodayKey(), 14),
  );
  const controllerRef = React.useRef<AbortController | null>(null);
  const [editTask, setEditTask] = React.useState<LaundryTaskDTO | null>(null);

  const load = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (!opts?.silent) setLoading(true);
      setError("");
      try {
        const days =
          Math.round(
            (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000,
          ) + 1;
        if (!Number.isFinite(days) || days < 1 || days > 366)
          throw new Error("Choose a date range of 1–366 days.");
        const res = await fetch(
          `/api/laundry/week?start=${sydneyDayStart(startDate).toISOString()}&days=${days}`,
          {
            cache: "no-store",
            signal: controller.signal,
            headers: { "x-progress-toast": "off" },
          },
        );
        const body = await res.json();
        if (!res.ok || !Array.isArray(body))
          throw new Error(body.error || "Could not load laundry runs.");
        if (!controller.signal.aborted) setTasks(body);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load laundry runs.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [startDate, endDate],
  );

  React.useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load({ silent: true });
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      controllerRef.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  // Optimistic delete against DELETE /api/laundry/[taskId] — the row leaves the
  // list straight away and is restored if the server refuses (e.g. 409 on a
  // completed set without a forced confirm).
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const tasksRef = React.useRef<LaundryTaskDTO[]>([]);
  React.useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const removeTask = React.useCallback(
    async (task: { id: string }, payload: LaundryDeletePayload) => {
      const snapshot = tasksRef.current;
      setDeletingId(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      try {
        const res = await fetch(`/api/laundry/${task.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setTasks(snapshot);
          toast({
            title: "Could not delete",
            description: body?.error ?? "The laundry set could not be removed.",
            variant: "destructive",
          });
          return false;
        }
        toast({
          title:
            payload.mode === "PERMANENT"
              ? "Laundry set deleted"
              : "Removed from the boards",
          description: body?.mayBeRecreated
            ? "The plan generator may recreate this set from its job."
            : undefined,
        });
        await load({ silent: true });
        return true;
      } catch (err: any) {
        setTasks(snapshot);
        toast({
          title: "Delete failed",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        });
        return false;
      } finally {
        setDeletingId(null);
      }
    },
    [load],
  );

  const { requestDelete, modal: deleteModal } =
    useLaundryDeleteDialog(removeTask);

  const filteredTasks = React.useMemo(
    () =>
      tasks.filter((task) => {
        const matches = [
          task.property?.name,
          task.property?.address,
          task.property?.suburb,
          task.property?.client?.name,
          task.supplier?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        return matches && (status === "all" || task.status === status);
      }),
    [tasks, search, status],
  );

  const todayTasks = React.useMemo(
    () =>
      filteredTasks
        .filter((t) => !isCompleted(t))
        .sort(
          (a, b) =>
            new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime(),
        ),
    [filteredTasks],
  );
  const completedTasks = React.useMemo(
    () =>
      filteredTasks
        .filter(isCompleted)
        .sort(
          (a, b) =>
            new Date(b.dropoffDate).getTime() -
            new Date(a.dropoffDate).getTime(),
        ),
    [filteredTasks],
  );

  // Stat tiles keyed off today (Sydney).
  const stats = React.useMemo(() => {
    const today = sydneyTodayKey();
    const inWindow = (value: string) =>
      sydneyDateKey(new Date(value)) === today;
    const loadsToday = tasks.filter(
      (t) => inWindow(t.pickupDate) || inWindow(t.dropoffDate),
    ).length;
    const inTransit = tasks.filter((t) => t.status === "PICKED_UP").length;
    const deliveredToday = tasks.filter(
      (t) => t.status === "DROPPED" && t.droppedAt && inWindow(t.droppedAt),
    ).length;
    return { loadsToday, inTransit, deliveredToday };
  }, [tasks]);

  const tabs: Array<{
    key: TabKey;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    {
      key: "today",
      label: "Active runs",
      icon: <ClipboardList className="h-3.5 w-3.5" />,
      count: todayTasks.length,
    },
    {
      key: "investigate",
      label: "Investigate property",
      icon: <ClipboardList className="h-3.5 w-3.5" />,
    },
    { key: "live", label: "Live", icon: <Radio className="h-3.5 w-3.5" /> },
    {
      key: "completed",
      label: "Completed",
      icon: <PackageCheck className="h-3.5 w-3.5" />,
      count: completedTasks.length,
    },
    {
      key: "reports",
      label: "Reports",
      icon: <Scale className="h-3.5 w-3.5" />,
    },
    {
      key: "suppliers",
      label: "Suppliers",
      icon: <Store className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Laundry"
        description="Runs, live tracking, completed evidence, reports and suppliers."
        actions={
          <div className="flex items-center gap-2">
            <EButton asChild variant="ghost" size="sm">
              <Link href="/v2/admin/laundry/stats">
                <BarChart3 className="mr-1 h-3.5 w-3.5" />
                Statistics
              </Link>
            </EButton>
            <LaundryNewRun onApplied={() => void load()} />
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard
          label="Loads today"
          value={loading || error ? "—" : String(stats.loadsToday)}
          delta="in selected date range"
          deltaTone="neutral"
          icon={<Shirt className="h-4 w-4" />}
        />
        <EStatCard
          label="In transit"
          value={loading || error ? "—" : String(stats.inTransit)}
          delta="in selected date range"
          deltaTone="neutral"
          icon={<Truck className="h-4 w-4" />}
        />
        <EStatCard
          label="Delivered"
          value={loading || error ? "—" : String(stats.deliveredToday)}
          delta="today"
          icon={<PackageCheck className="h-4 w-4" />}
        />
      </section>

      {error && (
        <p role="alert" className="text-sm text-[hsl(var(--e-danger))]">
          {error} Existing rows may be out of date.{" "}
          <button className="underline" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {(tab === "today" || tab === "completed") && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            Search
            <input
              className="mt-1 min-h-11 w-full rounded border bg-transparent px-3"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Property, client or supplier"
            />
          </label>
          <label className="text-sm">
            Status
            <select
              className="mt-1 min-h-11 w-full rounded border bg-[hsl(var(--e-surface))] px-3"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              {[
                "PENDING",
                "CONFIRMED",
                "PICKED_UP",
                "DROPPED",
                "FLAGGED",
                "SKIPPED_PICKUP",
              ].map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            From
            <input
              type="date"
              className="mt-1 min-h-11 w-full rounded border bg-transparent px-3"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Through
            <input
              type="date"
              className="mt-1 min-h-11 w-full rounded border bg-transparent px-3"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>
      )}
      <p className="text-xs text-[hsl(var(--e-muted-foreground))]">
        Pickup or drop-off in the selected range; flagged work remains visible
        for follow-up. Dates use Sydney time. Refreshes every 30 seconds.
      </p>
      <TabBar active={tab} onSelect={setTab} tabs={tabs} />

      {tab === "today" ? (
        <div className="space-y-3">
          {loading ? (
            <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              Loading runs…
            </p>
          ) : error && tasks.length === 0 ? null : todayTasks.length === 0 ? (
            <EEmptyState
              eyebrow="Quiet"
              title="No laundry scheduled"
              description="No active runs match the selected dates and filters."
              action={<LaundryNewRun onApplied={() => void load()} />}
            />
          ) : (
            todayTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onEdit={setEditTask}
                onDelete={requestDelete}
                onReport={(task) => {
                  setReportTask({
                    id: task.id,
                    name: task.property?.name ?? "Property",
                  });
                  setTab("reports");
                }}
                onSaved={() => void load({ silent: true })}
                showMedia
                busy={deletingId === task.id}
              />
            ))
          )}
        </div>
      ) : null}

      {tab === "investigate" ? (
        <LaundryInvestigation
          initialTasks={tasks}
          canReviewBags={canReviewBags}
        />
      ) : null}

      {tab === "live" ? <LaundryLive /> : null}

      {tab === "completed" ? (
        <div className="space-y-3">
          {loading ? (
            <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              Loading history…
            </p>
          ) : error && tasks.length === 0 ? null : completedTasks.length ===
            0 ? (
            <EEmptyState
              eyebrow="Nothing yet"
              title="No completed runs"
              description="Delivered and skipped laundry runs appear here with their evidence."
            />
          ) : (
            completedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onEdit={setEditTask}
                onDelete={requestDelete}
                onReport={(task) => {
                  setReportTask({
                    id: task.id,
                    name: task.property?.name ?? "Property",
                  });
                  setTab("reports");
                }}
                onSaved={() => void load({ silent: true })}
                busy={deletingId === task.id}
                showMedia
              />
            ))
          )}
        </div>
      ) : null}

      {tab === "reports" ? (
        <LaundryReports
          key={reportTask?.id ?? "all"}
          task={reportTask}
          onClearTask={() => setReportTask(null)}
        />
      ) : null}

      {tab === "suppliers" ? <LaundrySuppliers /> : null}

      <LaundryEditDialog
        task={editTask}
        onClose={() => setEditTask(null)}
        onSaved={() => void load()}
      />
      {deleteModal}

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate workspace · live data from your operations.
      </p>
    </div>
  );
}
