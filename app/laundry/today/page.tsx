"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { CheckCircle2, MapPin, Package, RefreshCw, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/hooks/use-toast";

type LaundryStatus = "PENDING" | "CONFIRMED" | "PICKED_UP" | "DROPPED" | "FLAGGED" | "SKIPPED_PICKUP";
type StatusFilter = "all" | "pending" | "confirmed" | "flagged";
type DayBucket = "today" | "tomorrow";
type ActionKind = "pickup" | "dropoff";

type LaundryTask = {
  id: string;
  status: LaundryStatus;
  pickupDate: string;
  dropoffDate: string;
  flagReason?: string | null;
  flagNotes?: string | null;
  property: {
    id: string;
    name: string;
    suburb?: string | null;
    linenBufferSets?: number | null;
  };
  job?: { jobNumber?: string | null } | null;
  confirmations?: Array<{ laundryReady?: boolean; notes?: string | null }>;
};

const STATUS_VARIANT: Record<LaundryStatus, "neutral" | "info" | "success" | "warning" | "danger" | "primary"> = {
  PENDING: "neutral",
  CONFIRMED: "info",
  PICKED_UP: "primary",
  DROPPED: "success",
  FLAGGED: "danger",
  SKIPPED_PICKUP: "warning",
};

const STATUS_LABEL: Record<LaundryStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PICKED_UP: "Picked up",
  DROPPED: "Returned",
  FLAGGED: "Flagged",
  SKIPPED_PICKUP: "Skipped",
};

function bagCountFromConfirmations(task: LaundryTask): number {
  const confirmations = Array.isArray(task.confirmations) ? task.confirmations : [];
  for (const confirmation of confirmations) {
    if (!confirmation?.notes) continue;
    try {
      const meta = JSON.parse(confirmation.notes);
      if (meta?.event === "PICKED_UP" && typeof meta.bagCount === "number") {
        return Math.max(1, Math.round(meta.bagCount));
      }
    } catch {
      // ignore parse errors
    }
  }
  return task.property?.linenBufferSets ?? 1;
}

export default function LaundryTodayPage() {
  const [tasks, setTasks] = useState<LaundryTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const today = startOfDay(new Date()).toISOString();
      const res = await fetch(`/api/laundry/week?start=${today}&days=2`);
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast({
        title: "Could not load laundry tasks",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const buckets = useMemo(() => {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);

    function classify(task: LaundryTask): { bucket: DayBucket; kind: ActionKind } | null {
      const pickup = new Date(task.pickupDate);
      const dropoff = new Date(task.dropoffDate);
      // Pending pickup takes priority — show in pickup column for whichever day it falls on
      if (task.status === "CONFIRMED" || task.status === "PENDING" || task.status === "FLAGGED") {
        if (isSameDay(pickup, today)) return { bucket: "today", kind: "pickup" };
        if (isSameDay(pickup, tomorrow)) return { bucket: "tomorrow", kind: "pickup" };
      }
      if (task.status === "PICKED_UP") {
        if (isSameDay(dropoff, today)) return { bucket: "today", kind: "dropoff" };
        if (isSameDay(dropoff, tomorrow)) return { bucket: "tomorrow", kind: "dropoff" };
        // Overdue picked-up tasks → today dropoff column
        if (dropoff < today) return { bucket: "today", kind: "dropoff" };
      }
      // Already dropped today
      if (task.status === "DROPPED") {
        if (isSameDay(dropoff, today)) return { bucket: "today", kind: "dropoff" };
        if (isSameDay(dropoff, tomorrow)) return { bucket: "tomorrow", kind: "dropoff" };
      }
      return null;
    }

    const filtered = tasks.filter((task) => {
      if (filter === "all") return true;
      if (filter === "pending") return task.status === "PENDING";
      if (filter === "confirmed") return task.status === "CONFIRMED";
      if (filter === "flagged") return task.status === "FLAGGED";
      return true;
    });

    const out: Record<DayBucket, { pickups: LaundryTask[]; dropoffs: LaundryTask[] }> = {
      today: { pickups: [], dropoffs: [] },
      tomorrow: { pickups: [], dropoffs: [] },
    };

    for (const task of filtered) {
      const slot = classify(task);
      if (!slot) continue;
      if (slot.kind === "pickup") out[slot.bucket].pickups.push(task);
      else out[slot.bucket].dropoffs.push(task);
    }

    for (const day of ["today", "tomorrow"] as const) {
      out[day].pickups.sort((a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime());
      out[day].dropoffs.sort((a, b) => new Date(a.dropoffDate).getTime() - new Date(b.dropoffDate).getTime());
    }

    return out;
  }, [tasks, filter]);

  async function quickConfirm(task: LaundryTask, kind: ActionKind) {
    setSubmittingId(task.id);
    try {
      const payload: any = { confirm: true };
      if (kind === "pickup") {
        payload.status = "PICKED_UP";
        payload.bagCount = bagCountFromConfirmations(task);
      } else {
        payload.status = "RETURNED";
        payload.dropoffLocation = "Cleaners cupboard";
      }
      const res = await fetch(`/api/laundry/${task.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Backend may require dropoff photo — direct the user to the full editor.
        const message = body?.error ?? "Could not update status. Open full planner for details.";
        toast({ title: "Quick confirm needs more info", description: message, variant: "destructive" });
        return;
      }
      toast({
        title: kind === "pickup" ? "Pickup confirmed" : "Drop-off confirmed",
        description: task.property?.name ?? "Laundry task",
      });
      await load();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Today and tomorrow"
        description="Pickups and drop-offs for the next two days. Use the full planner for history, edits, and reschedules."
        icon={<Truck />}
        actions={
          <>
            <Select value={filter} onValueChange={(value) => setFilter(value as StatusFilter)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="flagged">Flagged</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-1.5 size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/laundry">Full planner</Link>
            </Button>
          </>
        }
      />

      <DayBoard
        title="Today"
        subtitle={format(new Date(), "EEEE, d MMM")}
        pickups={buckets.today.pickups}
        dropoffs={buckets.today.dropoffs}
        loading={loading}
        submittingId={submittingId}
        onConfirm={quickConfirm}
      />
      <DayBoard
        title="Tomorrow"
        subtitle={format(addDays(new Date(), 1), "EEEE, d MMM")}
        pickups={buckets.tomorrow.pickups}
        dropoffs={buckets.tomorrow.dropoffs}
        loading={loading}
        submittingId={submittingId}
        onConfirm={quickConfirm}
      />
    </div>
  );
}

function DayBoard({
  title,
  subtitle,
  pickups,
  dropoffs,
  loading,
  submittingId,
  onConfirm,
}: {
  title: string;
  subtitle: string;
  pickups: LaundryTask[];
  dropoffs: LaundryTask[];
  loading: boolean;
  submittingId: string | null;
  onConfirm: (task: LaundryTask, kind: ActionKind) => void;
}) {
  return (
    <Card>
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-lg font-bold tracking-tight">{title}</CardTitle>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 md:grid-cols-2">
        <BoardColumn
          icon={<Truck className="size-4" />}
          label="Pickups"
          tasks={pickups}
          loading={loading}
          submittingId={submittingId}
          actionKind="pickup"
          actionLabel="Confirm pickup"
          onConfirm={onConfirm}
        />
        <BoardColumn
          icon={<Package className="size-4" />}
          label="Drop-offs"
          tasks={dropoffs}
          loading={loading}
          submittingId={submittingId}
          actionKind="dropoff"
          actionLabel="Confirm drop-off"
          onConfirm={onConfirm}
        />
      </CardContent>
    </Card>
  );
}

function BoardColumn({
  icon,
  label,
  tasks,
  loading,
  submittingId,
  actionKind,
  actionLabel,
  onConfirm,
}: {
  icon: React.ReactNode;
  label: string;
  tasks: LaundryTask[];
  loading: boolean;
  submittingId: string | null;
  actionKind: ActionKind;
  actionLabel: string;
  onConfirm: (task: LaundryTask, kind: ActionKind) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
        <span className="tabular-nums">({tasks.length})</span>
      </div>
      {loading && tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing scheduled.
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const bagCount = bagCountFromConfirmations(task);
            const showAction =
              (actionKind === "pickup" && (task.status === "CONFIRMED" || task.status === "PENDING")) ||
              (actionKind === "dropoff" && task.status === "PICKED_UP");
            const isOverdue =
              actionKind === "dropoff" &&
              task.status === "PICKED_UP" &&
              new Date(task.dropoffDate) < startOfDay(new Date());

            return (
              <li
                key={task.id}
                className="rounded-xl border border-border bg-surface px-3 py-3 shadow-sm transition hover:shadow"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {task.property?.name ?? "Unknown property"}
                      </span>
                      <StatusPill
                        variant={STATUS_VARIANT[task.status] ?? "neutral"}
                        size="sm"
                      >
                        {STATUS_LABEL[task.status] ?? task.status}
                      </StatusPill>
                      {isOverdue ? (
                        <StatusPill variant="danger" size="sm">
                          Overdue
                        </StatusPill>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {task.property?.suburb ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {task.property.suburb}
                        </span>
                      ) : null}
                      <span>
                        {actionKind === "pickup"
                          ? `Pickup ${format(new Date(task.pickupDate), "HH:mm")}`
                          : `Return ${format(new Date(task.dropoffDate), "HH:mm")}`}
                      </span>
                      <span>
                        {bagCount} bag{bagCount === 1 ? "" : "s"}
                      </span>
                      {task.job?.jobNumber ? <span>#{task.job.jobNumber}</span> : null}
                    </div>
                    {task.flagNotes ? (
                      <p className="mt-1 line-clamp-2 text-xs text-destructive">{task.flagNotes}</p>
                    ) : null}
                  </div>
                  {showAction ? (
                    <Button
                      disabled={submittingId === task.id}
                      onClick={() => onConfirm(task, actionKind)}
                      className="h-11 shrink-0 px-4"
                    >
                      <CheckCircle2 className="mr-1.5 size-4" />
                      {submittingId === task.id ? "Saving…" : actionLabel}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
