"use client";

/**
 * Estate laundry live board + tracking — the single source of truth for the v2
 * laundry Queue, Runs and Tracking screens. Hits the SAME endpoints the v1
 * laundry workspace uses so status is always accurate:
 *   GET  /api/laundry/week?start=<iso>&days=<n>        → LaundryTask[]
 *   POST /api/laundry/[taskId]/status  { confirm:true, status, … }
 *
 * The real status model (prisma LaundryStatus):
 *   PENDING → CONFIRMED → PICKED_UP → DROPPED   (+ FLAGGED, SKIPPED_PICKUP)
 * The status endpoint accepts the action verbs:
 *   PICKED_UP  (needs bagCount)      — from PENDING/CONFIRMED
 *   RETURNED   (needs dropoffLocation) — maps server-side to DROPPED, from PICKED_UP
 *   REVERT_TO_CONFIRMED / REVERT_TO_PICKED_UP
 * Everything is Estate-token styled; zero live-component imports.
 */
import * as React from "react";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Package,
  RefreshCw,
  RotateCcw,
  Truck,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/cleaner/fields";
import { toast } from "@/hooks/use-toast";

/* ── Types (mirror the /api/laundry/week payload) ──────────────────────── */
export type LaundryStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PICKED_UP"
  | "DROPPED"
  | "FLAGGED"
  | "SKIPPED_PICKUP";

type Confirmation = { laundryReady?: boolean; notes?: string | null; createdAt?: string };

export type BoardTask = {
  id: string;
  status: LaundryStatus;
  pickupDate: string;
  dropoffDate: string;
  pickedUpAt?: string | null;
  droppedAt?: string | null;
  bagWeightKg?: number | null;
  flagReason?: string | null;
  flagNotes?: string | null;
  noPickupRequired?: boolean;
  property: {
    id?: string;
    name: string | null;
    suburb?: string | null;
    address?: string | null;
    linenBufferSets?: number | null;
  } | null;
  confirmations?: Confirmation[];
};

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

/* ── Status presentation ───────────────────────────────────────────────── */
export const STATUS_TONE: Record<LaundryStatus, Tone> = {
  PENDING: "neutral",
  CONFIRMED: "primary",
  PICKED_UP: "info",
  DROPPED: "success",
  FLAGGED: "danger",
  SKIPPED_PICKUP: "warning",
};

export const STATUS_LABEL: Record<LaundryStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PICKED_UP: "Picked up",
  DROPPED: "Returned",
  FLAGGED: "Flagged",
  SKIPPED_PICKUP: "Skipped",
};

function propertyLabel(t: BoardTask): string {
  const name = t.property?.name ?? "Property";
  const suburb = t.property?.suburb ?? "";
  return suburb ? `${name}, ${suburb}` : name;
}

function bagCountFor(task: BoardTask): number {
  const confirmations = Array.isArray(task.confirmations) ? task.confirmations : [];
  for (const c of confirmations) {
    if (!c?.notes) continue;
    try {
      const meta = JSON.parse(c.notes);
      if (meta?.event === "PICKED_UP" && typeof meta.bagCount === "number") {
        return Math.max(1, Math.round(meta.bagCount));
      }
    } catch {
      /* ignore */
    }
  }
  return Math.max(1, task.property?.linenBufferSets ?? 1);
}

/* ── Shared data hook: fetch the real week feed, refresh every 20s ──────── */
function useLaundryFeed(days: number) {
  const [tasks, setTasks] = React.useState<BoardTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [submittingId, setSubmittingId] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const start = startOfDay(new Date()).toISOString();
        const res = await fetch(`/api/laundry/week?start=${start}&days=${days}`, {
          cache: "no-store",
        });
        const data = await res.json();
        setTasks(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (!opts?.silent) {
          toast({
            title: "Could not load laundry tasks",
            description: err?.message ?? "Unknown error",
            variant: "destructive",
          });
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [days]
  );

  React.useEffect(() => {
    void load();
    const id = setInterval(() => void load({ silent: true }), 20_000);
    return () => clearInterval(id);
  }, [load]);

  const act = React.useCallback(
    async (task: BoardTask, payload: Record<string, unknown>, successTitle: string) => {
      setSubmittingId(task.id);
      try {
        const res = await fetch(`/api/laundry/${task.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true, ...payload }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            title: "Could not update",
            description: body?.error ?? "The status could not be changed.",
            variant: "destructive",
          });
          return false;
        }
        toast({ title: successTitle, description: propertyLabel(task) });
        await load({ silent: true });
        return true;
      } catch (err: any) {
        toast({ title: "Update failed", description: err?.message ?? "Unknown error", variant: "destructive" });
        return false;
      } finally {
        setSubmittingId(null);
      }
    },
    [load]
  );

  return { tasks, loading, submittingId, load, act };
}

function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <EButton variant="outline" size="sm" onClick={onClick} disabled={loading}>
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      Refresh
    </EButton>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   QUEUE — every active set grouped by real stage.
   ══════════════════════════════════════════════════════════════════════════ */
const QUEUE_STAGES: { status: LaundryStatus; tone: Tone }[] = [
  { status: "PENDING", tone: "neutral" },
  { status: "CONFIRMED", tone: "primary" },
  { status: "PICKED_UP", tone: "info" },
  { status: "DROPPED", tone: "success" },
];

export function QueueBoard() {
  // 30-day window so the queue shows the genuine backlog, not just today.
  const { tasks, loading, load } = useLaundryFeed(30);

  // Active queue = anything not a no-pickup task; FLAGGED shown in its own strip.
  const active = tasks.filter((t) => !t.noPickupRequired);
  const flagged = active.filter((t) => t.status === "FLAGGED" || t.status === "SKIPPED_PICKUP");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <RefreshButton loading={loading} onClick={() => void load()} />
      </div>

      {flagged.length > 0 ? (
        <ECard>
          <ECardBody className="space-y-2 pt-6">
            <div className="flex items-center justify-between">
              <p className="text-[0.8125rem] font-semibold uppercase tracking-wide text-[hsl(var(--e-danger))]">
                Needs attention
              </p>
              <EBadge tone="danger" soft>
                {flagged.length}
              </EBadge>
            </div>
            {flagged.map((t) => (
              <div
                key={t.id}
                className="flex items-start justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{propertyLabel(t)}</p>
                  {t.flagNotes ? (
                    <p className="mt-0.5 line-clamp-2 text-[0.75rem] text-[hsl(var(--e-danger))]">{t.flagNotes}</p>
                  ) : null}
                </div>
                <EBadge tone={STATUS_TONE[t.status]} soft>
                  {STATUS_LABEL[t.status]}
                </EBadge>
              </div>
            ))}
          </ECardBody>
        </ECard>
      ) : null}

      {active.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="Nothing in the queue" description="No active laundry sets right now." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {QUEUE_STAGES.map((s) => {
            const items = active.filter((t) => t.status === s.status);
            return (
              <ECard key={s.status}>
                <ECardBody className="space-y-3 pt-6">
                  <div className="flex items-center justify-between">
                    <p className="text-[0.8125rem] font-semibold uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">
                      {STATUS_LABEL[s.status]}
                    </p>
                    <EBadge tone={s.tone} soft>
                      {items.length}
                    </EBadge>
                  </div>
                  <div className="space-y-2">
                    {items.length === 0 ? (
                      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">None</p>
                    ) : (
                      items.map((it) => {
                        const bags = bagCountFor(it);
                        return (
                          <div
                            key={it.id}
                            className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]"
                          >
                            <p className="min-w-0 truncate font-medium">{propertyLabel(it)}</p>
                            <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                              {bags} bag{bags === 1 ? "" : "s"}
                              {it.bagWeightKg ? ` · ${it.bagWeightKg} kg` : ""}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   RUNS — today's pickup + drop-off loops with accurate done counts.
   A pickup is "done" once picked up; a drop is "done" once returned.
   ══════════════════════════════════════════════════════════════════════════ */
function classifyRuns(tasks: BoardTask[]) {
  const today = startOfDay(new Date());
  const pickups: BoardTask[] = [];
  const dropoffs: BoardTask[] = [];

  for (const t of tasks) {
    if (t.noPickupRequired) continue;
    const pickup = new Date(t.pickupDate);
    const dropoff = new Date(t.dropoffDate);

    // Pickup loop: still-to-collect (or collected today) sets scheduled for today.
    if (["PENDING", "CONFIRMED", "FLAGGED"].includes(t.status) && isSameDay(pickup, today)) {
      pickups.push(t);
    } else if (t.status === "PICKED_UP" && isSameDay(pickup, today)) {
      pickups.push(t);
    }

    // Drop-off loop: picked-up sets due back today (or overdue), plus today's returns.
    if (t.status === "PICKED_UP") {
      if (isSameDay(dropoff, today) || dropoff < today) dropoffs.push(t);
    } else if (t.status === "DROPPED" && t.droppedAt && isSameDay(new Date(t.droppedAt), today)) {
      dropoffs.push(t);
    }
  }
  pickups.sort((a, b) => +new Date(a.pickupDate) - +new Date(b.pickupDate));
  dropoffs.sort((a, b) => +new Date(a.dropoffDate) - +new Date(b.dropoffDate));
  return { pickups, dropoffs };
}

export function RunsBoard() {
  const { tasks, loading, submittingId, load, act } = useLaundryFeed(2);
  const { pickups, dropoffs } = classifyRuns(tasks);

  const pickupsDone = pickups.filter((t) => Boolean(t.pickedUpAt) || t.status === "PICKED_UP" || t.status === "DROPPED").length;
  const dropsDone = dropoffs.filter((t) => Boolean(t.droppedAt) || t.status === "DROPPED").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <RefreshButton loading={loading} onClick={() => void load()} />
      </div>

      {pickups.length === 0 && dropoffs.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="No runs today" description="No pickups or drop-offs are scheduled for today." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <RunColumn
            title="Pickup loop"
            icon={<Truck className="h-4 w-4" />}
            tasks={pickups}
            done={pickupsDone}
            kind="pickup"
            submittingId={submittingId}
            act={act}
          />
          <RunColumn
            title="Drop-off loop"
            icon={<Package className="h-4 w-4" />}
            tasks={dropoffs}
            done={dropsDone}
            kind="dropoff"
            submittingId={submittingId}
            act={act}
          />
        </div>
      )}
    </div>
  );
}

function RunColumn({
  title,
  icon,
  tasks,
  done,
  kind,
  submittingId,
  act,
}: {
  title: string;
  icon: React.ReactNode;
  tasks: BoardTask[];
  done: number;
  kind: "pickup" | "dropoff";
  submittingId: string | null;
  act: (task: BoardTask, payload: Record<string, unknown>, successTitle: string) => Promise<boolean>;
}) {
  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <p className="inline-flex items-center gap-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">
            {icon}
            {title}
          </p>
          <EBadge tone={tasks.length > 0 && done === tasks.length ? "success" : "info"} soft>
            {done}/{tasks.length} done
          </EBadge>
        </div>
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">None scheduled</p>
          ) : (
            tasks.map((t) => {
              const complete = kind === "pickup" ? Boolean(t.pickedUpAt) || ["PICKED_UP", "DROPPED"].includes(t.status) : Boolean(t.droppedAt) || t.status === "DROPPED";
              const canPickup = kind === "pickup" && ["PENDING", "CONFIRMED"].includes(t.status);
              const canDrop = kind === "dropoff" && t.status === "PICKED_UP";
              const overdue = kind === "dropoff" && t.status === "PICKED_UP" && new Date(t.dropoffDate) < startOfDay(new Date());
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{propertyLabel(t)}</p>
                    <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {kind === "pickup"
                        ? `Pickup ${format(new Date(t.pickupDate), "HH:mm")}`
                        : `Return ${format(new Date(t.dropoffDate), "HH:mm")}`}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {overdue ? <EBadge tone="danger" soft>Overdue</EBadge> : null}
                    {canPickup ? (
                      <EButton
                        size="sm"
                        disabled={submittingId === t.id}
                        onClick={() => void act(t, { status: "PICKED_UP", bagCount: bagCountFor(t) }, "Pickup confirmed")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {submittingId === t.id ? "Saving…" : "Pickup"}
                      </EButton>
                    ) : canDrop ? (
                      <EButton
                        size="sm"
                        disabled={submittingId === t.id}
                        onClick={() =>
                          void act(t, { status: "RETURNED", dropoffLocation: "Cleaners cupboard" }, "Drop-off confirmed")
                        }
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {submittingId === t.id ? "Saving…" : "Return"}
                      </EButton>
                    ) : (
                      <EBadge tone={complete ? "success" : STATUS_TONE[t.status]} soft>
                        {complete ? "Done" : STATUS_LABEL[t.status]}
                      </EBadge>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ECardBody>
    </ECard>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TRACKING — per-task status timeline + inline update actions.
   ══════════════════════════════════════════════════════════════════════════ */
const TIMELINE: { status: LaundryStatus; label: string }[] = [
  { status: "CONFIRMED", label: "Confirmed" },
  { status: "PICKED_UP", label: "Picked up" },
  { status: "DROPPED", label: "Returned" },
];

function stageIndex(status: LaundryStatus): number {
  switch (status) {
    case "PENDING":
    case "CONFIRMED":
    case "FLAGGED":
      return 0;
    case "PICKED_UP":
      return 1;
    case "DROPPED":
      return 2;
    default:
      return 0;
  }
}

export function TrackingBoard() {
  const { tasks, loading, submittingId, load, act } = useLaundryFeed(14);
  const [dropLocations, setDropLocations] = React.useState<Record<string, string>>({});

  // Live tracking = everything currently moving through the pipeline (exclude
  // no-pickup + already-returned-and-old so the list stays actionable).
  const tracked = tasks
    .filter((t) => !t.noPickupRequired)
    .filter((t) => t.status !== "SKIPPED_PICKUP")
    .sort((a, b) => stageIndex(a.status) - stageIndex(b.status) || +new Date(a.pickupDate) - +new Date(b.pickupDate));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <RefreshButton loading={loading} onClick={() => void load()} />
      </div>

      {tracked.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="Nothing to track" description="No laundry sets are moving through the pipeline right now." />
      ) : (
        <div className="space-y-3">
          {tracked.map((t) => {
            const idx = stageIndex(t.status);
            const bags = bagCountFor(t);
            const canPickup = ["PENDING", "CONFIRMED"].includes(t.status);
            const canDrop = t.status === "PICKED_UP";
            const canRevert = ["PICKED_UP", "DROPPED"].includes(t.status);
            return (
              <ECard key={t.id}>
                <ECardBody className="space-y-4 pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.9375rem] font-semibold">{propertyLabel(t)}</p>
                      <p className="mt-0.5 inline-flex items-center gap-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {t.property?.suburb ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {t.property.suburb}
                          </span>
                        ) : null}
                        <span>Pickup {format(new Date(t.pickupDate), "d MMM")}</span>
                        <span>Return {format(new Date(t.dropoffDate), "d MMM")}</span>
                        <span>
                          {bags} bag{bags === 1 ? "" : "s"}
                        </span>
                      </p>
                    </div>
                    <EBadge tone={STATUS_TONE[t.status]} soft>
                      {STATUS_LABEL[t.status]}
                    </EBadge>
                  </div>

                  {/* Timeline */}
                  <div className="flex items-center gap-1">
                    {TIMELINE.map((step, i) => {
                      const reached = t.status === "FLAGGED" ? i === 0 : i <= idx;
                      const current = i === idx && t.status !== "FLAGGED";
                      return (
                        <React.Fragment key={step.status}>
                          <div className="flex flex-col items-center gap-1">
                            <span
                              className="flex h-6 w-6 items-center justify-center rounded-full border text-[0.625rem] font-semibold"
                              style={{
                                borderColor: reached ? "hsl(var(--e-success))" : "hsl(var(--e-border-strong))",
                                backgroundColor: reached
                                  ? "color-mix(in srgb, hsl(var(--e-success)) 16%, transparent)"
                                  : "transparent",
                                color: reached ? "hsl(var(--e-success))" : "hsl(var(--e-text-faint))",
                              }}
                            >
                              {reached ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                            </span>
                            <span
                              className="text-[0.625rem] font-medium"
                              style={{ color: current ? "hsl(var(--e-foreground))" : "hsl(var(--e-text-faint))" }}
                            >
                              {step.label}
                            </span>
                          </div>
                          {i < TIMELINE.length - 1 ? (
                            <span
                              className="mb-4 h-px flex-1"
                              style={{ backgroundColor: i < idx ? "hsl(var(--e-success))" : "hsl(var(--e-border))" }}
                            />
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {t.flagNotes ? (
                    <p className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-foreground))]">
                      {t.flagNotes}
                    </p>
                  ) : null}

                  {/* Update actions */}
                  {canPickup || canDrop || canRevert ? (
                    <div className="flex flex-wrap items-end gap-2 border-t border-[hsl(var(--e-border))] pt-3">
                      {canPickup ? (
                        <EButton
                          size="sm"
                          disabled={submittingId === t.id}
                          onClick={() => void act(t, { status: "PICKED_UP", bagCount: bags }, "Marked picked up")}
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                          {submittingId === t.id ? "Saving…" : "Mark picked up"}
                        </EButton>
                      ) : null}

                      {canDrop ? (
                        <>
                          <div className="min-w-[180px] flex-1">
                            <EInput
                              placeholder="Drop-off location (e.g. Cleaners cupboard)"
                              value={dropLocations[t.id] ?? ""}
                              onChange={(e) =>
                                setDropLocations((p) => ({ ...p, [t.id]: e.target.value }))
                              }
                            />
                          </div>
                          <EButton
                            size="sm"
                            disabled={submittingId === t.id}
                            onClick={() =>
                              void act(
                                t,
                                {
                                  status: "RETURNED",
                                  dropoffLocation: (dropLocations[t.id] ?? "").trim() || "Cleaners cupboard",
                                },
                                "Marked returned"
                              )
                            }
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                            {submittingId === t.id ? "Saving…" : "Mark returned"}
                          </EButton>
                        </>
                      ) : null}

                      {canRevert ? (
                        <EButton
                          variant="ghost"
                          size="sm"
                          disabled={submittingId === t.id}
                          onClick={() =>
                            void act(
                              t,
                              { status: t.status === "DROPPED" ? "REVERT_TO_PICKED_UP" : "REVERT_TO_CONFIRMED" },
                              "Reverted"
                            )
                          }
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Undo
                        </EButton>
                      ) : null}
                    </div>
                  ) : null}
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
    </div>
  );
}
