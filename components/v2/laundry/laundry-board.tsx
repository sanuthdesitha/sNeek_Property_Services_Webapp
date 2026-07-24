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
import { format, startOfDay } from "date-fns";
import jsQR from "jsqr";
import { MediaGallery } from "@/components/shared/media-gallery";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Copy,
  FilePenLine,
  MapPin,
  Navigation,
  Package,
  QrCode,
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
import { EAccessInfo } from "@/components/v2/shared/access-info";
import { useLaundryActionModal } from "@/components/v2/laundry/laundry-action-modal";
import { useLaundryDateScope, type LaundryDateRange } from "@/components/v2/laundry/date-scope";
import { LAUNDRY_SKIP_REASONS } from "@/lib/laundry/constants";
import { fullAddressText, googleMapsDirectionsUrl } from "@/lib/maps/google-maps-url";
import { buildGoogleMapsMultiStopUrl } from "@/lib/jobs/schedule-order";
import { toast } from "@/hooks/use-toast";

/* ── Types (mirror the /api/laundry/week payload) ──────────────────────── */
export type LaundryStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PICKED_UP"
  | "DROPPED"
  | "FLAGGED"
  | "SKIPPED_PICKUP";

type Confirmation = {
  id?: string;
  laundryReady?: boolean;
  notes?: string | null;
  createdAt?: string;
  photoUrl?: string | null;
  bagLocation?: string | null;
};

export type BoardTask = {
  id: string;
  status: LaundryStatus;
  pickupDate: string;
  dropoffDate: string;
  createdAt?: string | null;
  confirmedAt?: string | null;
  updatedAt?: string | null;
  pickedUpAt?: string | null;
  droppedAt?: string | null;
  bagWeightKg?: number | null;
  flagReason?: string | null;
  flagNotes?: string | null;
  noPickupRequired?: boolean;
  skipReasonCode?: string | null;
  skipReasonNote?: string | null;
  adminOverrideNote?: string | null;
  receiptImageUrl?: string | null;
  supplierId?: string | null;
  supplier?: { id: string; name: string | null } | null;
  property: {
    id?: string;
    name: string | null;
    suburb?: string | null;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    linenBufferSets?: number | null;
    accessInfo?: unknown;
    client?: { id?: string; name: string | null; email?: string | null } | null;
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
  // Deliberately "Returned" (not the client-facing "Delivered"): the laundry
  // team's action verb is returning the sets to the property, and every board
  // action/timeline here says "Return"/"Returned". Client + admin surfaces
  // say "Delivered" for the same DROPPED status.
  DROPPED: "Returned",
  FLAGGED: "Flagged",
  SKIPPED_PICKUP: "Skipped",
};

function propertyLabel(t: BoardTask): string {
  const name = t.property?.name ?? "Property";
  const suburb = t.property?.suburb ?? "";
  return suburb ? `${name}, ${suburb}` : name;
}

/** Full street address for a task's property; falls back to name + suburb. */
function taskAddressText(t: BoardTask): string {
  const full = fullAddressText({
    address: t.property?.address ?? null,
    suburb: t.property?.suburb ?? null,
  });
  return full || propertyLabel(t);
}

/**
 * Google Maps directions URL to a task's property — prefers the saved rooftop
 * pin (lat/lng) and falls back to the full street address. "" when neither
 * exists, so callers can hide the Navigate button.
 */
function taskNavUrl(t: BoardTask): string {
  return googleMapsDirectionsUrl({
    address: t.property?.address ?? null,
    suburb: t.property?.suburb ?? null,
    latitude: t.property?.latitude ?? null,
    longitude: t.property?.longitude ?? null,
  });
}

/** A per-card "Navigate" button — hidden when the task has no usable location. */
function NavButton({ task }: { task: BoardTask }) {
  const url = taskNavUrl(task);
  if (!url) return null;
  return (
    <EButton variant="outline" size="sm" asChild>
      <a href={url} target="_blank" rel="noreferrer" aria-label="Open directions in Google Maps">
        <Navigation className="h-3.5 w-3.5" />
        Navigate
      </a>
    </EButton>
  );
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

function parseNotes(notes: string | null | undefined): any {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

function eventConfirmation(task: BoardTask, eventName: string): Confirmation | undefined {
  const confirmations = Array.isArray(task.confirmations) ? [...task.confirmations] : [];
  return confirmations.reverse().find((c) => parseNotes(c?.notes)?.event === eventName);
}

/** Evidence photos attached to a task (cleaner ready, pickup, drop-off, receipt). */
function taskPhotos(task: BoardTask): Array<{ id: string; url: string; label: string }> {
  const photos: Array<{ id: string; url: string; label: string }> = [];
  const cleaner = (task.confirmations ?? []).find(
    (c) => c?.laundryReady === true && Boolean(c?.photoUrl) && !parseNotes(c?.notes)?.event
  );
  if (cleaner?.photoUrl) photos.push({ id: cleaner.id ?? `${task.id}-cleaner`, url: cleaner.photoUrl, label: "Cleaner photo" });
  const pickedUp = eventConfirmation(task, "PICKED_UP");
  if (pickedUp?.photoUrl) photos.push({ id: pickedUp.id ?? `${task.id}-pickup`, url: pickedUp.photoUrl, label: "Pickup" });
  const dropped = eventConfirmation(task, "DROPPED");
  if (dropped?.photoUrl) photos.push({ id: dropped.id ?? `${task.id}-drop`, url: dropped.photoUrl, label: "Drop-off" });
  if (task.receiptImageUrl) photos.push({ id: `${task.id}-receipt`, url: task.receiptImageUrl, label: "Receipt" });
  return photos;
}

function pendingFailedPickupRequest(task: BoardTask): any | null {
  const confirmations = Array.isArray(task.confirmations) ? [...task.confirmations] : [];
  const row = confirmations.reverse().find((c) => {
    const meta = parseNotes(c?.notes);
    return meta?.event === "FAILED_PICKUP_REQUEST" && meta?.approvalStatus === "PENDING";
  });
  return row ? parseNotes(row.notes) : null;
}

function returnedEarly(task: BoardTask): boolean {
  if (!task.droppedAt || !task.dropoffDate) return false;
  return startOfDay(new Date(task.droppedAt)).getTime() < startOfDay(new Date(task.dropoffDate)).getTime();
}

function skipReasonLabel(code: string | null | undefined): string {
  if (!code) return "Not set";
  const match = LAUNDRY_SKIP_REASONS.find((r) => r.value === code);
  return match?.label ?? String(code).replace(/_/g, " ");
}

/** Full chronological activity log — Estate port of the v1 planner's task timeline. */
function buildTimeline(task: BoardTask): Array<{ at: Date; label: string }> {
  const events: Array<{ at: Date; label: string }> = [];
  if (task.createdAt) events.push({ at: new Date(task.createdAt), label: "Task created" });
  if (task.confirmedAt) events.push({ at: new Date(task.confirmedAt), label: "Laundry confirmed by cleaner" });

  for (const c of Array.isArray(task.confirmations) ? task.confirmations : []) {
    if (!c?.createdAt) continue;
    const at = new Date(c.createdAt);
    const meta = parseNotes(c.notes);
    if (meta?.event === "PICKED_UP") {
      events.push({
        at,
        label: `Picked up${meta.bagCount ? ` (${meta.bagCount} bag${meta.bagCount > 1 ? "s" : ""})` : ""}`,
      });
      continue;
    }
    if (meta?.event === "DROPPED") {
      const early =
        meta?.actualDroppedAt && meta?.intendedDropoffDate
          ? startOfDay(new Date(meta.actualDroppedAt)).getTime() < startOfDay(new Date(meta.intendedDropoffDate)).getTime()
          : false;
      events.push({
        at,
        label: `${early ? "Returned early" : "Returned"}${meta.dropoffLocation ? ` to ${meta.dropoffLocation}` : ""}${
          typeof meta.totalPrice === "number" ? ` ($${Number(meta.totalPrice).toFixed(2)})` : ""
        }${typeof meta.loadWeightKg === "number" ? ` (${Number(meta.loadWeightKg).toFixed(1)} kg)` : ""}`,
      });
      continue;
    }
    if (meta?.event === "EDIT_COMPLETED") {
      const changed = Array.isArray(meta.changedFields) ? meta.changedFields.length : 0;
      events.push({ at, label: `Completion details edited${changed > 0 ? ` (${changed} fields)` : ""}` });
      continue;
    }
    if (meta?.event === "REVERT_TO_CONFIRMED") {
      events.push({ at, label: "Reverted back to Confirmed" });
      continue;
    }
    if (meta?.event === "REVERT_TO_PICKED_UP") {
      events.push({ at, label: "Reverted back to Picked Up" });
      continue;
    }
    if (meta?.event === "FAILED_PICKUP_RESCHEDULE") {
      events.push({
        at,
        label: `Failed pickup rescheduled${
          meta.rescheduledPickupDate ? ` to ${format(new Date(meta.rescheduledPickupDate), "dd MMM")}` : ""
        }${meta.reason ? ` (${meta.reason})` : ""}`,
      });
      continue;
    }
    if (meta?.event === "FAILED_PICKUP_REQUEST") {
      events.push({
        at,
        label: `Failed pickup approval requested for ${String(meta.requestedAction ?? "SKIP").toLowerCase()}${
          meta.reason ? ` (${meta.reason})` : ""
        }`,
      });
      continue;
    }
    events.push({
      at,
      label: c.laundryReady
        ? `Cleaner marked ready${c.bagLocation ? ` (${c.bagLocation})` : ""}`
        : "Cleaner marked not ready",
    });
  }

  if (task.pickedUpAt) events.push({ at: new Date(task.pickedUpAt), label: "Picked up" });
  if (task.droppedAt) events.push({ at: new Date(task.droppedAt), label: "Returned" });
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function ActivityTimeline({ events }: { events: Array<{ at: Date; label: string }> }) {
  if (events.length === 0) return null;
  return (
    <details className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2">
      <summary className="cursor-pointer select-none text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">
        Activity ({events.length})
      </summary>
      <ol className="mt-2 space-y-1.5">
        {events.map((e, i) => (
          <li key={`${e.at.getTime()}-${i}`} className="flex gap-2 text-[0.75rem]">
            <span className="mt-[0.3rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--e-border-strong))]" />
            <span className="text-[hsl(var(--e-muted-foreground))]">
              <span className="tabular-nums text-[hsl(var(--e-text-faint))]">
                {format(e.at, "d MMM HH:mm")}
              </span>{" "}
              — <span className="text-[hsl(var(--e-foreground))]">{e.label}</span>
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function PhotoStrip({ photos }: { photos: Array<{ id: string; url: string; label: string }> }) {
  if (photos.length === 0) return null;
  return (
    <MediaGallery
      items={photos.map((p) => ({ id: p.id, url: p.url, label: p.label }))}
      title="Laundry evidence"
      className="grid grid-cols-3 gap-2 sm:grid-cols-5"
    />
  );
}

/* ── Shared data hook: fetch the real week feed, refresh every 20s ──────── */
function useLaundryFeed(range: LaundryDateRange) {
  const [tasks, setTasks] = React.useState<BoardTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [submittingId, setSubmittingId] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const start = range.start.toISOString();
        const res = await fetch(`/api/laundry/week?start=${start}&days=${range.days}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        // A failed refetch (e.g. this network's intermittent DNS drop, or a
        // transient 5xx) must NOT wipe the board to empty — that would hide a
        // status the user just saved and read as "the update didn't stick".
        // Only replace the list when the response is a genuine task array.
        if (!res.ok || !Array.isArray(data)) {
          const message =
            (data && typeof data === "object" && "error" in data && (data as any).error) ||
            `Request failed (${res.status})`;
          throw new Error(String(message));
        }
        setTasks(data);
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
    [range]
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
  // Default to the whole week so the queue shows the genuine backlog, not just
  // today; the scope chips (Today / Tomorrow / This week / Custom) narrow it.
  const { range, control } = useLaundryDateScope("week");
  const { tasks, loading, load } = useLaundryFeed(range);

  // Active queue = anything not a no-pickup task; FLAGGED shown in its own strip.
  const active = tasks.filter((t) => !t.noPickupRequired);
  const flagged = active.filter((t) => t.status === "FLAGGED" || t.status === "SKIPPED_PICKUP");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {control}
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
                  {t.status === "SKIPPED_PICKUP" ? (
                    <div className="mt-0.5 space-y-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <p>
                        <span className="font-[550]">Reason:</span> {skipReasonLabel(t.skipReasonCode)}
                      </p>
                      {t.skipReasonNote ? <p className="line-clamp-2">Cleaner note: {t.skipReasonNote}</p> : null}
                      {t.adminOverrideNote ? <p className="line-clamp-2">Admin note: {t.adminOverrideNote}</p> : null}
                    </div>
                  ) : t.flagNotes ? (
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
                            {it.property?.address || it.property?.suburb ? (
                              <p className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">{taskAddressText(it)}</span>
                              </p>
                            ) : null}
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                                {bags} bag{bags === 1 ? "" : "s"}
                                {it.bagWeightKg ? ` · ${it.bagWeightKg} kg` : ""}
                              </p>
                              <NavButton task={it} />
                            </div>
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
function classifyRuns(tasks: BoardTask[], range: LaundryDateRange) {
  const inRange = (d: Date) => d >= range.start && d < range.endExclusive;
  const pickups: BoardTask[] = [];
  const dropoffs: BoardTask[] = [];

  for (const t of tasks) {
    if (t.noPickupRequired) continue;
    const pickup = new Date(t.pickupDate);
    const dropoff = new Date(t.dropoffDate);

    // Pickup loop: still-to-collect (or collected) sets scheduled in the range.
    if (["PENDING", "CONFIRMED", "FLAGGED", "PICKED_UP"].includes(t.status) && inRange(pickup)) {
      pickups.push(t);
    }

    // Drop-off loop: picked-up sets due back in range (or overdue), plus
    // returns completed within the range.
    if (t.status === "PICKED_UP") {
      if (dropoff < range.endExclusive) dropoffs.push(t);
    } else if (t.status === "DROPPED" && t.droppedAt && inRange(new Date(t.droppedAt))) {
      dropoffs.push(t);
    }
  }
  pickups.sort((a, b) => +new Date(a.pickupDate) - +new Date(b.pickupDate));
  dropoffs.sort((a, b) => +new Date(a.dropoffDate) - +new Date(b.dropoffDate));
  return { pickups, dropoffs };
}

export function RunsBoard() {
  const { range, control } = useLaundryDateScope("today");
  const { tasks, loading, submittingId, load } = useLaundryFeed(range);
  const { openAction, modal } = useLaundryActionModal(() => void load({ silent: true }));
  const { pickups, dropoffs } = classifyRuns(tasks, range);

  const pickupsDone = pickups.filter((t) => Boolean(t.pickedUpAt) || t.status === "PICKED_UP" || t.status === "DROPPED").length;
  const dropsDone = dropoffs.filter((t) => Boolean(t.droppedAt) || t.status === "DROPPED").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {control}
        <RefreshButton loading={loading} onClick={() => void load()} />
      </div>

      {pickups.length === 0 && dropoffs.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="No runs" description="No pickups or drop-offs are scheduled in the selected range." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <RunColumn
            title="Pickup loop"
            icon={<Truck className="h-4 w-4" />}
            tasks={pickups}
            done={pickupsDone}
            kind="pickup"
            submittingId={submittingId}
            openAction={openAction}
          />
          <RunColumn
            title="Drop-off loop"
            icon={<Package className="h-4 w-4" />}
            tasks={dropoffs}
            done={dropsDone}
            kind="dropoff"
            submittingId={submittingId}
            openAction={openAction}
          />
        </div>
      )}
      {modal}
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
  openAction,
}: {
  title: string;
  icon: React.ReactNode;
  tasks: BoardTask[];
  done: number;
  kind: "pickup" | "dropoff";
  submittingId: string | null;
  openAction: (task: BoardTask, action: "PICKED_UP" | "RETURNED" | "FAILED_PICKUP") => void;
}) {
  // Multi-stop directions for the whole loop, in scheduled order, starting from
  // the device's current location. Mirrors the route-map "Open in Google Maps".
  const routeUrl =
    tasks.length > 1
      ? buildGoogleMapsMultiStopUrl(
          tasks.map((t) => taskAddressText(t)),
          { fromCurrentLocation: true, travelMode: "driving" }
        )
      : null;
  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">
            {icon}
            {title}
          </p>
          <div className="flex items-center gap-2">
            {routeUrl ? (
              <EButton variant="outline" size="sm" asChild>
                <a href={routeUrl} target="_blank" rel="noreferrer" aria-label="Open the full route in Google Maps">
                  <Navigation className="h-3.5 w-3.5" />
                  Navigate route
                </a>
              </EButton>
            ) : null}
            <EBadge tone={tasks.length > 0 && done === tasks.length ? "success" : "info"} soft>
              {done}/{tasks.length} done
            </EBadge>
          </div>
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
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{propertyLabel(t)}</p>
                    {t.property?.address || t.property?.suburb ? (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{taskAddressText(t)}</span>
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {kind === "pickup"
                        ? `Pickup ${format(new Date(t.pickupDate), "HH:mm")}`
                        : `Return ${format(new Date(t.dropoffDate), "HH:mm")}`}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                    <NavButton task={t} />
                    {overdue ? <EBadge tone="danger" soft>Overdue</EBadge> : null}
                    {canPickup ? (
                      <>
                        <EButton size="sm" disabled={submittingId === t.id} onClick={() => openAction(t, "PICKED_UP")}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Pickup
                        </EButton>
                        <EButton variant="ghost" size="sm" disabled={submittingId === t.id} onClick={() => openAction(t, "FAILED_PICKUP")}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Failed
                        </EButton>
                      </>
                    ) : canDrop ? (
                      <EButton size="sm" disabled={submittingId === t.id} onClick={() => openAction(t, "RETURNED")}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Return
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

async function decodeQrFromFile(file: File): Promise<string | null> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read QR image."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load QR image."));
    img.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not open QR scanner.");
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height);
  return result?.data?.trim() || null;
}

export function TrackingBoard() {
  const { range, control } = useLaundryDateScope("week");
  const { tasks, loading, submittingId, load, act } = useLaundryFeed(range);
  const { openAction, modal, config } = useLaundryActionModal(() => void load({ silent: true }));
  const [scanningQr, setScanningQr] = React.useState(false);
  const [highlightId, setHighlightId] = React.useState<string | null>(null);

  // Live tracking = everything currently moving through the pipeline (exclude
  // no-pickup + already-returned-and-old so the list stays actionable).
  const tracked = tasks
    .filter((t) => !t.noPickupRequired)
    .filter((t) => t.status !== "SKIPPED_PICKUP")
    .sort((a, b) => stageIndex(a.status) - stageIndex(b.status) || +new Date(a.pickupDate) - +new Date(b.pickupDate));

  // Deep-link support: the calendar (and any `…/tracking#task-<id>` link) jumps
  // to a specific set. Because the feed loads async, native hash-scroll fires
  // before the cards exist — so we scroll + briefly highlight once data is in,
  // and again whenever the hash changes while already on this page.
  const jumpToHash = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const match = /^#task-(.+)$/.exec(window.location.hash);
    if (!match) return;
    const taskId = decodeURIComponent(match[1]);
    const el = document.getElementById(`task-${taskId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(taskId);
    window.setTimeout(() => setHighlightId((cur) => (cur === taskId ? null : cur)), 2400);
  }, []);

  React.useEffect(() => {
    if (!loading && tasks.length > 0) jumpToHash();
  }, [loading, tasks, jumpToHash]);

  React.useEffect(() => {
    window.addEventListener("hashchange", jumpToHash);
    return () => window.removeEventListener("hashchange", jumpToHash);
  }, [jumpToHash]);

  // Same "Scan bag QR" workflow as the v1 planner: decode a photo of the bag's
  // QR label and jump straight to the task's next action.
  async function handleQrScanSelection(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setScanningQr(true);
    try {
      const value = await decodeQrFromFile(file);
      if (!value) {
        toast({ title: "Scan failed", description: "No QR code was detected in that image.", variant: "destructive" });
        return;
      }
      const target = tasks.find((t) => t.id === value);
      if (!target) {
        toast({ title: "QR code not recognised", description: "No laundry task matched that QR code.", variant: "destructive" });
        return;
      }
      if (target.status === "CONFIRMED" || target.status === "PENDING") openAction(target, "PICKED_UP");
      else if (target.status === "PICKED_UP") openAction(target, "RETURNED");
      else if (target.status === "DROPPED") openAction(target, "EDIT_COMPLETED");
      else {
        toast({
          title: "Task found",
          description: `${propertyLabel(target)} is currently ${String(target.status).replace(/_/g, " ").toLowerCase()}.`,
        });
      }
    } catch (err: any) {
      toast({ title: "Scan failed", description: err?.message ?? "Could not scan the QR code.", variant: "destructive" });
    } finally {
      setScanningQr(false);
    }
  }

  // Copyable schedule summary — same route-planning helper as the v1 planner.
  async function copyScheduleSummary() {
    const text =
      tracked.length === 0
        ? "No laundry schedule items in the selected range."
        : tracked
            .map(
              (t) =>
                `${format(new Date(t.pickupDate), "EEE dd MMM yyyy")} - ${propertyLabel(t)} | Pickup ${format(
                  new Date(t.pickupDate),
                  "dd MMM"
                )} | Drop ${format(new Date(t.dropoffDate), "dd MMM")} | ${String(t.status).replace(/_/g, " ")}`
            )
            .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Schedule summary copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {control}
        <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] transition-colors hover:bg-[hsl(var(--e-muted))]">
          <QrCode className="h-3.5 w-3.5" />
          {scanningQr ? "Scanning…" : "Scan bag QR"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={async (e) => {
              const input = e.currentTarget;
              await handleQrScanSelection(input.files);
              input.value = "";
            }}
          />
        </label>
        <EButton variant="outline" size="sm" onClick={() => void copyScheduleSummary()}>
          <Copy className="h-3.5 w-3.5" />
          Copy summary
        </EButton>
        <RefreshButton loading={loading} onClick={() => void load()} />
        </div>
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
            const pendingRequest = pendingFailedPickupRequest(t);
            const droppedEarly = returnedEarly(t);
            const droppedMeta = parseNotes(eventConfirmation(t, "DROPPED")?.notes);
            const earlyReason =
              typeof droppedMeta?.earlyDropoffReason === "string" ? droppedMeta.earlyDropoffReason : "";
            const photos = taskPhotos(t);
            const overdue =
              t.status === "PICKED_UP" &&
              startOfDay(new Date(t.dropoffDate)).getTime() < startOfDay(new Date()).getTime();
            const timeline = buildTimeline(t);
            const clientName = t.property?.client?.name ?? null;
            const supplierName = t.supplier?.name ?? null;
            const bufferSets = t.property?.linenBufferSets ?? null;
            const isHighlighted = highlightId === t.id;
            return (
              <ECard
                key={t.id}
                id={`task-${t.id}`}
                variant={isHighlighted ? "ceremony" : "default"}
                className="scroll-mt-24 transition-shadow duration-300"
              >
                <ECardBody className="space-y-4 pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.9375rem] font-semibold">{propertyLabel(t)}</p>
                      {clientName ? (
                        <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          Client · {clientName}
                        </p>
                      ) : null}
                      <p className="mt-0.5 inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {t.property?.address || t.property?.suburb ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {taskAddressText(t)}
                          </span>
                        ) : null}
                        <span>Pickup {format(new Date(t.pickupDate), "d MMM · HH:mm")}</span>
                        <span>Return {format(new Date(t.dropoffDate), "d MMM · HH:mm")}</span>
                        <span>
                          {bags} bag{bags === 1 ? "" : "s"}
                        </span>
                        {bufferSets != null ? (
                          <span>
                            Buffer {bufferSets} set{bufferSets === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {supplierName ? (
                          <span className="inline-flex items-center gap-1">
                            <Truck className="h-3 w-3" />
                            {supplierName}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                      {overdue ? (
                        <EBadge tone="danger" soft>
                          Overdue
                        </EBadge>
                      ) : null}
                      <EBadge tone={STATUS_TONE[t.status]} soft>
                        {STATUS_LABEL[t.status]}
                      </EBadge>
                      <NavButton task={t} />
                    </div>
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

                  {/* Pending failed-pickup approval */}
                  {pendingRequest ? (
                    <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.35)] bg-[hsl(var(--e-danger)/0.06)] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-danger))]">
                      Awaiting admin approval to {String(pendingRequest.requestedAction ?? "SKIP").toLowerCase()} this pickup.
                    </p>
                  ) : null}

                  {/* Early return notice */}
                  {droppedEarly ? (
                    <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning)/0.08)] px-3 py-2 text-[0.75rem]">
                      <span className="font-[600]">Early return.</span> Planned {format(new Date(t.dropoffDate), "dd MMM yyyy")},
                      actual {t.droppedAt ? format(new Date(t.droppedAt), "dd MMM yyyy") : "—"}
                      {earlyReason ? ` — ${earlyReason}` : ""}
                    </p>
                  ) : null}

                  {/* Evidence photos + costs */}
                  <PhotoStrip photos={photos} />
                  {config.showCostTracking && droppedMeta?.totalPrice != null ? (
                    <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-primary))]">
                      ${Number(droppedMeta.totalPrice).toFixed(2)}
                      {droppedMeta?.loadWeightKg != null ? ` · ${Number(droppedMeta.loadWeightKg).toFixed(1)} kg` : ""}
                      {t.supplier?.name ? ` · ${t.supplier.name}` : ""}
                    </p>
                  ) : null}

                  {/* Property access instructions (same data the v1 planner showed) */}
                  <EAccessInfo accessInfo={t.property?.accessInfo} />

                  {/* Full activity timeline (same event log as the v1 planner) */}
                  <ActivityTimeline events={timeline} />

                  {/* Update actions */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] pt-3">
                    {canPickup ? (
                      <>
                        <EButton size="sm" disabled={submittingId === t.id} onClick={() => openAction(t, "PICKED_UP")}>
                          <ArrowRight className="h-3.5 w-3.5" />
                          Mark picked up
                        </EButton>
                        <EButton variant="outline" size="sm" disabled={submittingId === t.id} onClick={() => openAction(t, "FAILED_PICKUP")}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Failed pickup
                        </EButton>
                      </>
                    ) : null}

                    {canDrop ? (
                      <EButton size="sm" disabled={submittingId === t.id} onClick={() => openAction(t, "RETURNED")}>
                        <ChevronRight className="h-3.5 w-3.5" />
                        Mark returned
                      </EButton>
                    ) : null}

                    {t.status === "DROPPED" ? (
                      <EButton variant="outline" size="sm" disabled={submittingId === t.id} onClick={() => openAction(t, "EDIT_COMPLETED")}>
                        <FilePenLine className="h-3.5 w-3.5" />
                        Edit details
                      </EButton>
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
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
      {modal}
    </div>
  );
}
