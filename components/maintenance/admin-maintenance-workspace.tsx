"use client";

import * as React from "react";
import {
  Wrench,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  ListChecks,
  Image as ImageIcon,
  History,
} from "lucide-react";
import {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  MaintenanceStatus,
} from "@prisma/client";
import { KpiTile } from "@/components/charts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/hooks/use-toast";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  priorityTone,
  statusTone,
} from "@/lib/maintenance/labels";

const CATEGORIES = Object.values(MaintenanceCategory);
const PRIORITIES = Object.values(MaintenancePriority);
const STATUSES = Object.values(MaintenanceStatus);
const SOURCES = Object.values(MaintenanceSource);

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
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function AdminMaintenanceWorkspace({ properties }: { properties: PropertyOption[] }) {
  const [items, setItems] = React.useState<MaintenanceItem[]>([]);
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);

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
    try {
      const res = await fetch("/api/maintenance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), status: target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Bulk update failed", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "Updated", description: `${body.updated ?? selected.size} item(s) set to ${STATUS_LABELS[target]}.` });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, target: MaintenanceStatus) {
    setBusy(true);
    try {
      const res = await fetch(`/api/maintenance/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not update", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "Status updated", description: STATUS_LABELS[target] });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const allChecked = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Open" value={summary?.open ?? 0} icon={<ListChecks />} tone="info" />
        <KpiTile label="Urgent" value={summary?.urgent ?? 0} icon={<AlertTriangle />} tone="destructive" />
        <KpiTile label="In progress / ordered" value={summary?.inProgress ?? 0} icon={<Loader2 />} tone="warning" />
        <KpiTile label="Resolved this month" value={summary?.resolvedThisMonth ?? 0} icon={<CheckCircle2 />} tone="success" />
      </div>

      {/* Filters */}
      <Card className="rounded-xl">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <FilterSelect label="Property" value={propertyId} onChange={setPropertyId} className="w-56"
            options={[{ value: "ALL", label: "All properties" }, ...properties.map((p) => ({ value: p.id, label: p.suburb ? `${p.name} · ${p.suburb}` : p.name }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus}
            options={[{ value: "ALL", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]} />
          <FilterSelect label="Priority" value={priority} onChange={setPriority}
            options={[{ value: "ALL", label: "All priorities" }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))]} />
          <FilterSelect label="Category" value={category} onChange={setCategory}
            options={[{ value: "ALL", label: "All categories" }, ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]} />
          <FilterSelect label="Source" value={source} onChange={setSource}
            options={[{ value: "ALL", label: "All sources" }, ...SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))]} />
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm">
          <span className="text-sm font-medium tabular-nums">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {BULK_ACTIONS.map((a) => (
              <Button key={a.status} size="sm" variant="outline" disabled={busy} onClick={() => bulkUpdate(a.status)}>
                {a.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={busy}>Clear</Button>
          </div>
        </div>
      ) : null}

      {/* List */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Wrench className="h-6 w-6" />}
          title="No maintenance items"
          body="Items reported by cleaners, QA inspectors, clients, or admins on Airbnb properties show up here."
        />
      ) : (
        <Card className="overflow-hidden rounded-xl">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Select all" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {items.length} item(s)
            </span>
          </div>
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-raised/50">
                <Checkbox
                  checked={selected.has(item.id)}
                  onCheckedChange={() => toggle(item.id)}
                  aria-label={`Select ${item.title}`}
                  className="mt-1"
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setDetailId(item.id)}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-foreground">{item.title}</span>
                    <Badge variant={priorityTone(item.priority)}>{PRIORITY_LABELS[item.priority]}</Badge>
                    <Badge variant={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Badge>
                    {!item.clientVisible ? <Badge variant="outline">Internal</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.property?.name ?? ""}{item.area ? ` · ${item.area}` : ""} · {CATEGORY_LABELS[item.category]} · {ACTION_LABELS[item.recommendedAction]} · {SOURCE_LABELS[item.source]}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {item.photos && item.photos.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ImageIcon className="h-3 w-3" />{item.photos.length}
                    </span>
                  ) : null}
                  <Select value={item.status} onValueChange={(v) => changeStatus(item.id, v as MaintenanceStatus)}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Detail drawer with full event history */}
      <Drawer open={Boolean(detailId)} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DrawerContent side="right" className="flex w-full max-w-lg flex-col p-0">
          {detailItem ? (
            <>
              <DrawerHeader className="border-b border-border p-6 pb-4">
                <DrawerTitle>{detailItem.title}</DrawerTitle>
                <DrawerDescription>
                  {detailItem.property?.name ?? ""}{detailItem.area ? ` · ${detailItem.area}` : ""}
                </DrawerDescription>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant={priorityTone(detailItem.priority)}>{PRIORITY_LABELS[detailItem.priority]}</Badge>
                  <Badge variant={statusTone(detailItem.status)}>{STATUS_LABELS[detailItem.status]}</Badge>
                  <Badge variant="secondary">{CATEGORY_LABELS[detailItem.category]}</Badge>
                  <Badge variant="outline">{ACTION_LABELS[detailItem.recommendedAction]}</Badge>
                </div>
              </DrawerHeader>
              <ScrollArea className="flex-1">
                <div className="space-y-5 p-6">
                  {detailItem.description ? (
                    <p className="text-sm text-foreground">{detailItem.description}</p>
                  ) : null}

                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <Field label="Reported by" value={`${detailItem.reportedBy?.name ?? detailItem.reportedBy?.email ?? "—"} (${SOURCE_LABELS[detailItem.source]})`} />
                    <Field label="Reported" value={fmtDate(detailItem.createdAt)} />
                    {detailItem.job?.jobNumber ? <Field label="Job" value={detailItem.job.jobNumber} /> : null}
                    {detailItem.estimatedCost != null ? <Field label="Est. cost" value={`$${detailItem.estimatedCost.toFixed(2)}`} /> : null}
                    <Field label="Client visible" value={detailItem.clientVisible ? "Yes" : "No"} />
                    {detailItem.resolvedAt ? <Field label="Closed" value={`${fmtDate(detailItem.resolvedAt)}${detailItem.resolvedBy?.name ? ` · ${detailItem.resolvedBy.name}` : ""}`} /> : null}
                  </dl>

                  {detailItem.photos && detailItem.photos.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {detailItem.photos.map((photo) => (
                        <a key={photo.key} href={photo.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.url} alt={detailItem.title} className="h-20 w-20 rounded-lg border border-border object-cover" />
                        </a>
                      ))}
                    </div>
                  ) : null}

                  {/* Inline status change inside the drawer */}
                  <div className="space-y-1.5">
                    <Label>Change status</Label>
                    <Select value={detailItem.status} onValueChange={(v) => changeStatus(detailItem.id, v as MaintenanceStatus)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Event history */}
                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <History className="h-4 w-4" /> History
                    </p>
                    <ol className="space-y-2 border-l-2 border-border pl-4">
                      {(detailItem.events ?? []).map((ev) => (
                        <li key={ev.id} className="relative">
                          <span className="absolute -left-[1.4rem] top-1 h-2 w-2 rounded-full bg-primary" />
                          <div className="flex flex-wrap items-center gap-1.5 text-sm">
                            {ev.fromStatus ? (
                              <span className="text-muted-foreground">{STATUS_LABELS[ev.fromStatus]} →</span>
                            ) : null}
                            <Badge variant={statusTone(ev.toStatus)}>{STATUS_LABELS[ev.toStatus]}</Badge>
                          </div>
                          {ev.note ? <p className="text-xs text-muted-foreground">{ev.note}</p> : null}
                          <p className="text-[11px] text-muted-foreground">
                            {fmtDate(ev.createdAt)}{ev.user?.name ? ` · ${ev.user.name}` : ""}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </ScrollArea>
            </>
          ) : null}
        </DrawerContent>
      </Drawer>
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
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={className ?? "w-44"}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
