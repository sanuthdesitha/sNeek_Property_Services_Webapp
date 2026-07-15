"use client";

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
import { format, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  ClipboardList,
  Images,
  PackageCheck,
  Pencil,
  Radio,
  Scale,
  Shirt,
  Store,
  Truck,
  Weight,
} from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState, EPageHeader, EStatCard } from "@/components/v2/ui/primitives";
import { MediaGallery } from "@/components/shared/media-gallery";
import { LaundrySuppliers } from "@/components/v2/admin/laundry/laundry-suppliers";
import { LaundryEditDialog } from "./laundry-edit-dialog";
import { LaundryLive } from "./laundry-live";
import { LaundryReports } from "./laundry-reports";
import { LaundryNewRun } from "./laundry-new-run";
import {
  buildTaskMedia,
  isCompleted,
  mediaCount,
  statusLabel,
  statusTone,
  type LaundryTaskDTO,
} from "./laundry-shared";

const TZ = "Australia/Sydney";

type TabKey = "today" | "live" | "completed" | "reports" | "suppliers";

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
  tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode; count?: number }>;
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
  showMedia,
}: {
  task: LaundryTaskDTO;
  onEdit: (task: LaundryTaskDTO) => void;
  showMedia?: boolean;
}) {
  const { name, suburb } = propertyLine(task);
  const clientName = task.property?.client?.name ?? task.property?.client?.email ?? null;
  const supplier = task.supplier?.name ?? null;
  const media = showMedia ? buildTaskMedia(task) : [];
  const count = mediaCount(task);

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.9375rem] font-[550]">
              {name}
              {suburb ? <span className="font-normal text-[hsl(var(--e-muted-foreground))]">, {suburb}</span> : null}
            </p>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {clientName ?? "Unassigned client"}
              {supplier ? ` · ${supplier}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              <span className="inline-flex items-center gap-1">
                <Truck className="h-3 w-3" /> Pickup {format(new Date(task.pickupDate), "EEE d MMM")}
              </span>
              <span className="inline-flex items-center gap-1">
                <PackageCheck className="h-3 w-3" /> Drop-off {format(new Date(task.dropoffDate), "EEE d MMM")}
              </span>
              <span className="inline-flex items-center gap-1">
                <Weight className="h-3 w-3" /> {task.bagWeightKg ? `${task.bagWeightKg} kg` : "Weight t.b.c."}
              </span>
              {count > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Images className="h-3 w-3" /> {count} photo{count === 1 ? "" : "s"}
                </span>
              ) : null}
              {task.dropoffCostAud != null ? (
                <span className="e-tnum inline-flex items-center gap-1 text-[hsl(var(--e-gold-ink))]">
                  ${Number(task.dropoffCostAud).toFixed(2)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <EBadge tone={statusTone(task.status)} soft>
              {statusLabel(task.status)}
            </EBadge>
            <EButton variant="outline" size="sm" onClick={() => onEdit(task)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </EButton>
          </div>
        </div>

        {task.flagNotes ? (
          <p className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] px-2.5 py-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            {task.flagNotes}
          </p>
        ) : null}

        {showMedia && media.length > 0 ? (
          <div className="border-t border-[hsl(var(--e-border))] pt-3">
            <p className="e-eyebrow mb-1.5">Evidence</p>
            <MediaGallery items={media} title="Laundry evidence" className="grid grid-cols-3 gap-2 sm:grid-cols-5" />
          </div>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

export function LaundryWorkspace() {
  const [tab, setTab] = React.useState<TabKey>("today");
  const [tasks, setTasks] = React.useState<LaundryTaskDTO[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editTask, setEditTask] = React.useState<LaundryTaskDTO | null>(null);

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      // Load a window that spans recent history (completed) + the current week
      // (today/upcoming): start on Monday of last week, 21 days forward.
      const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
      const start = new Date(monday.getTime() - 7 * 86_400_000);
      const res = await fetch(`/api/laundry/week?start=${start.toISOString()}&days=28`, { cache: "no-store" });
      const body = await res.json().catch(() => []);
      setTasks(Array.isArray(body) ? (body as LaundryTaskDTO[]) : []);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const todayTasks = React.useMemo(
    () => tasks.filter((t) => !isCompleted(t)).sort((a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime()),
    [tasks],
  );
  const completedTasks = React.useMemo(
    () => tasks.filter(isCompleted).sort((a, b) => new Date(b.dropoffDate).getTime() - new Date(a.dropoffDate).getTime()),
    [tasks],
  );

  // Stat tiles keyed off today (Sydney).
  const stats = React.useMemo(() => {
    const nowSyd = toZonedTime(new Date(), TZ);
    const dayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const inWindow = (v: string) => {
      const d = new Date(v);
      return d >= dayStart && d < dayEnd;
    };
    const loadsToday = tasks.filter((t) => inWindow(t.pickupDate) || inWindow(t.dropoffDate)).length;
    const inTransit = tasks.filter((t) => t.status === "PICKED_UP").length;
    const deliveredToday = tasks.filter((t) => t.status === "DROPPED" && t.droppedAt && inWindow(t.droppedAt)).length;
    return { loadsToday, inTransit, deliveredToday };
  }, [tasks]);

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode; count?: number }> = [
    { key: "today", label: "Today", icon: <ClipboardList className="h-3.5 w-3.5" />, count: todayTasks.length },
    { key: "live", label: "Live", icon: <Radio className="h-3.5 w-3.5" /> },
    { key: "completed", label: "Completed", icon: <PackageCheck className="h-3.5 w-3.5" />, count: completedTasks.length },
    { key: "reports", label: "Reports", icon: <Scale className="h-3.5 w-3.5" /> },
    { key: "suppliers", label: "Suppliers", icon: <Store className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Laundry"
        description="Runs, live tracking, completed evidence, reports and suppliers."
        actions={<LaundryNewRun onApplied={() => void load()} />}
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard label="Loads today" value={String(stats.loadsToday)} delta="in the pipeline" deltaTone="neutral" icon={<Shirt className="h-4 w-4" />} />
        <EStatCard label="In transit" value={String(stats.inTransit)} delta="picked up" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
        <EStatCard label="Delivered" value={String(stats.deliveredToday)} delta="today" icon={<PackageCheck className="h-4 w-4" />} />
      </section>

      <TabBar active={tab} onSelect={setTab} tabs={tabs} />

      {tab === "today" ? (
        <div className="space-y-3">
          {loading ? (
            <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading runs…</p>
          ) : todayTasks.length === 0 ? (
            <EEmptyState
              eyebrow="Quiet"
              title="No laundry scheduled"
              description="Nothing active in the laundry pipeline right now."
              action={<LaundryNewRun onApplied={() => void load()} />}
            />
          ) : (
            todayTasks.map((task) => <TaskCard key={task.id} task={task} onEdit={setEditTask} />)
          )}
        </div>
      ) : null}

      {tab === "live" ? <LaundryLive /> : null}

      {tab === "completed" ? (
        <div className="space-y-3">
          {loading ? (
            <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading history…</p>
          ) : completedTasks.length === 0 ? (
            <EEmptyState
              eyebrow="Nothing yet"
              title="No completed runs"
              description="Delivered and skipped laundry runs appear here with their evidence."
            />
          ) : (
            completedTasks.map((task) => <TaskCard key={task.id} task={task} onEdit={setEditTask} showMedia />)
          )}
        </div>
      ) : null}

      {tab === "reports" ? <LaundryReports /> : null}

      {tab === "suppliers" ? <LaundrySuppliers /> : null}

      <LaundryEditDialog task={editTask} onClose={() => setEditTask(null)} onSaved={() => void load()} />

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate workspace · live data from your operations.</p>
    </div>
  );
}
