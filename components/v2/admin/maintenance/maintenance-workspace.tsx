"use client";

/**
 * ESTATE — Admin maintenance oversight (native v2 port of
 * components/maintenance/admin-maintenance-workspace). Ticket / replacement list
 * with filters, KPI strip, per-item + bulk status actions, and a detail drawer
 * (Estate modal) with full event history. Distinct from the worker
 * /v2/maintenance portal.
 *
 * Endpoints (unchanged from v1):
 *   GET  /api/maintenance?summary=1&propertyId&status&priority&category&source → { items, summary }
 *   POST /api/maintenance/bulk          { ids, status } → { updated }
 *   PATCH /api/maintenance/:id          { status }
 */

import * as React from "react";
import Link from "next/link";
import {
  Wrench,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  ListChecks,
  Image as ImageIcon,
  History,
  ExternalLink,
  HardHat,
} from "lucide-react";
import {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  MaintenanceStatus,
} from "@prisma/client";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/maintenance/labels";
import {
  EButton,
  ECard,
  EBadge,
  EStatCard,
  EEmptyState,
  EAlert,
} from "@/components/v2/ui/primitives";
import { MediaGallery } from "@/components/shared/media-gallery";
import { ESelect, EField, EModal } from "@/components/v2/admin/estate-kit";

const CATEGORIES = Object.values(MaintenanceCategory);
const PRIORITIES = Object.values(MaintenancePriority);
const STATUSES = Object.values(MaintenanceStatus);
const SOURCES = Object.values(MaintenanceSource);

// Estate tone mapping (primitives' EBadge tones).
type ETone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function priorityTone(priority: MaintenancePriority): ETone {
  switch (priority) {
    case "URGENT":
      return "danger";
    case "HIGH":
      return "warning";
    case "MEDIUM":
      return "info";
    default:
      return "neutral";
  }
}

function statusTone(status: MaintenanceStatus): ETone {
  switch (status) {
    case "RESOLVED":
      return "success";
    case "DISMISSED":
      return "neutral";
    case "IN_PROGRESS":
      return "info";
    case "ORDERED":
      return "warning";
    case "ACKNOWLEDGED":
      return "primary";
    default:
      return "warning";
  }
}

interface PropertyOption {
  id: string;
  name: string;
  suburb?: string | null;
}

interface MaintenanceEvent {
  id: string;
  fromStatus: MaintenanceStatus | null;
  toStatus: MaintenanceStatus;
  note: string | null;
  createdAt: string;
  user?: { name: string | null; email: string | null; role: string } | null;
}

interface MaintenanceItem {
  id: string;
  propertyId: string;
  jobId: string | null;
  source: MaintenanceSource;
  category: MaintenanceCategory;
  area: string | null;
  title: string;
  description: string | null;
  recommendedAction: keyof typeof ACTION_LABELS;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  estimatedCost: number | null;
  clientVisible: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  property?: { name: string; suburb?: string | null };
  reportedBy?: { name: string | null; email: string | null; role: string };
  resolvedBy?: { name: string | null } | null;
  job?: { jobNumber: string } | null;
  photos?: Array<{ key: string; url: string }>;
  events?: MaintenanceEvent[];
  assignedWorker?: { id: string; name: string; trade?: string | null } | null;
}

interface Summary {
  total: number;
  open: number;
  urgent: number;
  inProgress: number;
  resolvedThisMonth: number;
}

const BULK_ACTIONS: { status: MaintenanceStatus; label: string }[] = [
  { status: "IN_PROGRESS", label: "Mark in progress" },
  { status: "ORDERED", label: "Mark ordered" },
  { status: "RESOLVED", label: "Mark resolved" },
  { status: "DISMISSED", label: "Dismiss" },
];

function fmtDate(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function EstateMaintenanceWorkspace({ properties }: { properties: PropertyOption[] }) {
  const [items, setItems] = React.useState<MaintenanceItem[]>([]);
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Filters
  const [propertyId, setPropertyId] = React.useState("ALL");
  const [status, setStatus] = React.useState("ALL");
  const [priority, setPriority] = React.useState("ALL");
  const [category, setCategory] = React.useState("ALL");
  const [source, setSource] = React.useState("ALL");

  // Detail drawer
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const detailItem = items.find((i) => i.id === detailId) ?? null;

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ summary: "1" });
    if (propertyId !== "ALL") params.set("propertyId", propertyId);
    if (status !== "ALL") params.set("status", status);
    if (priority !== "ALL") params.set("priority", priority);
    if (category !== "ALL") params.set("category", category);
    if (source !== "ALL") params.set("source", source);
    try {
      const res = await fetch(`/api/maintenance?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      setItems(Array.isArray(body.items) ? body.items : []);
      setSummary(body.summary ?? null);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [propertyId, status, priority, category, source]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }

  async function bulkUpdate(target: MaintenanceStatus) {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), status: target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Bulk update failed. Please retry.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, target: MaintenanceStatus) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not update. Please retry.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const allChecked = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-6">
      {error ? (
        <EAlert tone="danger" title="Something went wrong">
          {error}
        </EAlert>
      ) : null}

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard label="Open" value={summary?.open ?? 0} icon={<ListChecks className="h-4 w-4" />} />
        <EStatCard label="Urgent" value={summary?.urgent ?? 0} icon={<AlertTriangle className="h-4 w-4" />} />
        <EStatCard
          label="In progress / ordered"
          value={summary?.inProgress ?? 0}
          icon={<Loader2 className="h-4 w-4" />}
        />
        <EStatCard
          label="Resolved this month"
          value={summary?.resolvedThisMonth ?? 0}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      {/* Filters */}
      <ECard className="flex flex-wrap items-end gap-3 p-4">
        <FilterSelect
          label="Property"
          value={propertyId}
          onChange={setPropertyId}
          className="w-56"
          options={[
            { value: "ALL", label: "All properties" },
            ...properties.map((p) => ({ value: p.id, label: p.suburb ? `${p.name} · ${p.suburb}` : p.name })),
          ]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[{ value: "ALL", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]}
        />
        <FilterSelect
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={[{ value: "ALL", label: "All priorities" }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))]}
        />
        <FilterSelect
          label="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: "ALL", label: "All categories" }, ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]}
        />
        <FilterSelect
          label="Source"
          value={source}
          onChange={setSource}
          options={[{ value: "ALL", label: "All sources" }, ...SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))]}
        />
      </ECard>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 shadow-[var(--e-elevation-1)]">
          <span className="e-tnum text-[0.875rem] font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {BULK_ACTIONS.map((a) => (
              <EButton key={a.status} size="sm" variant="outline" disabled={busy} onClick={() => void bulkUpdate(a.status)}>
                {a.label}
              </EButton>
            ))}
            <EButton size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={busy}>
              Clear
            </EButton>
          </div>
        </div>
      ) : null}

      {/* List */}
      {loading ? (
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
      ) : items.length === 0 ? (
        <EEmptyState
          eyebrow="Maintenance"
          title="No maintenance items"
          description="Items reported by cleaners, QA inspectors, clients, or admins on Airbnb properties show up here."
        />
      ) : (
        <ECard className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[hsl(var(--e-border))] px-4 py-2.5">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              aria-label="Select all"
              className="h-4 w-4 accent-[hsl(var(--e-primary))]"
            />
            <span className="e-tnum text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">
              {items.length} item(s)
            </span>
          </div>
          <ul className="divide-y divide-[hsl(var(--e-border))]">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[hsl(var(--e-muted))]">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)}
                  aria-label={`Select ${item.title}`}
                  className="mt-1 h-4 w-4 accent-[hsl(var(--e-primary))]"
                />
                {item.photos && item.photos.length > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.photos[0].url}
                    alt=""
                    className="mt-0.5 h-10 w-10 shrink-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover"
                  />
                ) : null}
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDetailId(item.id)}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-[hsl(var(--e-foreground))]">{item.title}</span>
                    <EBadge tone={priorityTone(item.priority)} soft>
                      {PRIORITY_LABELS[item.priority]}
                    </EBadge>
                    <EBadge tone={statusTone(item.status)} soft>
                      {STATUS_LABELS[item.status]}
                    </EBadge>
                    {!item.clientVisible ? <EBadge tone="neutral">Internal</EBadge> : null}
                    {item.assignedWorker ? (
                      <EBadge tone="aubergine" soft>
                        <HardHat className="h-3 w-3" />
                        {item.assignedWorker.name}
                        {item.assignedWorker.trade ? ` · ${item.assignedWorker.trade}` : ""}
                      </EBadge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {item.property?.name ?? ""}
                    {item.area ? ` · ${item.area}` : ""} · {CATEGORY_LABELS[item.category]} ·{" "}
                    {ACTION_LABELS[item.recommendedAction]} · {SOURCE_LABELS[item.source]}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {item.photos && item.photos.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <ImageIcon className="h-3 w-3" />
                      {item.photos.length}
                    </span>
                  ) : null}
                  <EButton asChild size="sm" variant="outline" className="h-8">
                    <Link href={`/v2/admin/maintenance/${item.id}`}>
                      Open <ExternalLink className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </EButton>
                  <ESelect
                    className="h-8 w-36 text-[0.8125rem]"
                    value={item.status}
                    onChange={(e) => void changeStatus(item.id, e.target.value as MaintenanceStatus)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </ESelect>
                </div>
              </li>
            ))}
          </ul>
        </ECard>
      )}

      {/* Detail drawer (Estate modal) with full event history */}
      <EModal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        wide
        eyebrow={detailItem ? `${detailItem.property?.name ?? ""}${detailItem.area ? ` · ${detailItem.area}` : ""}` : undefined}
        title={detailItem?.title ?? "Maintenance item"}
      >
        {detailItem ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-1.5">
              <EBadge tone={priorityTone(detailItem.priority)} soft>
                {PRIORITY_LABELS[detailItem.priority]}
              </EBadge>
              <EBadge tone={statusTone(detailItem.status)} soft>
                {STATUS_LABELS[detailItem.status]}
              </EBadge>
              <EBadge tone="neutral">{CATEGORY_LABELS[detailItem.category]}</EBadge>
              <EBadge tone="gold" soft>
                {ACTION_LABELS[detailItem.recommendedAction]}
              </EBadge>
            </div>

            {detailItem.description ? (
              <p className="text-[0.875rem] text-[hsl(var(--e-foreground))]">{detailItem.description}</p>
            ) : null}

            <dl className="grid grid-cols-2 gap-3 text-[0.875rem]">
              <Field
                label="Reported by"
                value={`${detailItem.reportedBy?.name ?? detailItem.reportedBy?.email ?? "—"} (${SOURCE_LABELS[detailItem.source]})`}
              />
              <Field label="Reported" value={fmtDate(detailItem.createdAt)} />
              {detailItem.job?.jobNumber ? <Field label="Job" value={detailItem.job.jobNumber} /> : null}
              {detailItem.estimatedCost != null ? (
                <Field label="Est. cost" value={`$${detailItem.estimatedCost.toFixed(2)}`} />
              ) : null}
              <Field label="Client visible" value={detailItem.clientVisible ? "Yes" : "No"} />
              {detailItem.resolvedAt ? (
                <Field
                  label="Closed"
                  value={`${fmtDate(detailItem.resolvedAt)}${detailItem.resolvedBy?.name ? ` · ${detailItem.resolvedBy.name}` : ""}`}
                />
              ) : null}
            </dl>

            {detailItem.photos && detailItem.photos.length > 0 ? (
              <MediaGallery
                items={detailItem.photos.map((photo) => ({
                  id: photo.key,
                  url: photo.url,
                  mediaType: (photo as any).mediaType,
                }))}
                title={detailItem.title}
                className="grid grid-cols-3 gap-2 sm:grid-cols-5"
              />
            ) : null}

            {/* Inline status change */}
            <EField label="Change status">
              <ESelect
                value={detailItem.status}
                onChange={(e) => void changeStatus(detailItem.id, e.target.value as MaintenanceStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </ESelect>
            </EField>

            {/* Event history */}
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">
                <History className="h-4 w-4" /> History
              </p>
              <ol className="space-y-2 border-l-2 border-[hsl(var(--e-border))] pl-4">
                {(detailItem.events ?? []).map((ev) => (
                  <li key={ev.id} className="relative">
                    <span className="absolute -left-[1.4rem] top-1 h-2 w-2 rounded-full bg-[hsl(var(--e-gold))]" />
                    <div className="flex flex-wrap items-center gap-1.5 text-[0.875rem]">
                      {ev.fromStatus ? (
                        <span className="text-[hsl(var(--e-muted-foreground))]">{STATUS_LABELS[ev.fromStatus]} →</span>
                      ) : null}
                      <EBadge tone={statusTone(ev.toStatus)} soft>
                        {STATUS_LABELS[ev.toStatus]}
                      </EBadge>
                    </div>
                    {ev.note ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{ev.note}</p> : null}
                    <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                      {fmtDate(ev.createdAt)}
                      {ev.user?.name ? ` · ${ev.user.name}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex justify-end pt-1">
              <EButton asChild size="sm" variant="outline">
                <Link href={`/v2/admin/maintenance/${detailItem.id}`}>
                  Open full record <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Link>
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <EField label={label} className={className ?? "w-44"}>
      <ESelect value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </ESelect>
    </EField>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.6875rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">{label}</dt>
      <dd className="e-tnum text-[0.875rem] text-[hsl(var(--e-foreground))]">{value}</dd>
    </div>
  );
}
