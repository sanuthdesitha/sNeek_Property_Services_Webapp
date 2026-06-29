"use client";

import * as React from "react";
import { Wrench, Image as ImageIcon, Wrench as WrenchIcon } from "lucide-react";
import {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
} from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { MediaGallery } from "@/components/shared/media-gallery";
import { ReportMaintenanceSheet } from "@/components/maintenance/report-maintenance-sheet";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  priorityTone,
  statusTone,
} from "@/lib/maintenance/labels";

// Prettify an outcome enum value, e.g. NEEDS_PARTS → "Needs parts".
function prettyOutcome(outcome: string): string {
  const lower = outcome.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

interface MaintenanceItemDetail {
  status: MaintenanceStatus;
  outcome: string | null;
  workerNote: string | null;
  resolutionNote: string | null;
  finishPhotos?: Array<{ key: string; url: string }>;
}

interface ClientProperty {
  id: string;
  name: string;
  suburb?: string | null;
}

interface MaintenanceListItem {
  id: string;
  propertyId: string;
  category: MaintenanceCategory;
  area: string | null;
  title: string;
  description: string | null;
  recommendedAction: keyof typeof ACTION_LABELS;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  outcome?: string | null;
  property?: { name: string };
  photos?: Array<{ key: string; url: string }>;
}

// Opens on demand and fetches the single item so we have finishPhotos + notes
// (the list endpoint doesn't include them). Client-safe: no worker contact
// details or property access codes are rendered.
function WorkDoneDialog({ item }: { item: MaintenanceListItem }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [detail, setDetail] = React.useState<MaintenanceItemDetail | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/maintenance/${item.id}`, { cache: "no-store" })
      .then((res) => res.json().catch(() => ({})))
      .then((body) => {
        if (cancelled) return;
        setDetail(body?.item ?? null);
        setLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded, item.id]);

  const finishPhotos = detail?.finishPhotos ?? [];
  const note = detail?.workerNote ?? detail?.resolutionNote ?? null;
  const outcome = detail?.outcome ?? item.outcome ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <WrenchIcon className="mr-1 h-3 w-3" /> View work done
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Work done — {item.title}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3">
            {outcome ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Outcome:</span>
                <Badge variant="success">{prettyOutcome(outcome)}</Badge>
              </div>
            ) : null}
            {note ? (
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground">{note}</p>
            ) : null}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Completed work</p>
              <MediaGallery
                items={finishPhotos.map((p) => ({ id: p.key, url: p.url }))}
                title="Completed work"
                emptyText="No completion photos"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type AssignableWorker = { id: string; name: string; trade: string | null; company: string | null };

// Client-side management: assign an existing maintenance worker and move/track
// the status of an item on the client's own property.
function ManageDialog({ item, onSaved }: { item: MaintenanceListItem; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [workers, setWorkers] = React.useState<AssignableWorker[]>([]);
  const [workerId, setWorkerId] = React.useState("");
  const [status, setStatus] = React.useState<MaintenanceStatus>(item.status);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStatus(item.status);
    setWorkerId("");
    setNote("");
    fetch("/api/maintenance/workers", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((b) => setWorkers(Array.isArray(b.workers) ? b.workers : []));
  }, [open, item.status]);

  async function patch(payload: Record<string, unknown>, successTitle: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/maintenance/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not update", description: b.error ?? "Please retry.", variant: "destructive" });
        return false;
      }
      toast({ title: successTitle });
      return true;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
        <WrenchIcon className="mr-1 h-3 w-3" /> Manage
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage — {item.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Assign a worker */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Assign a maintenance person</Label>
            <Select value={workerId} onValueChange={setWorkerId}>
              <SelectTrigger><SelectValue placeholder="Choose a worker…" /></SelectTrigger>
              <SelectContent>
                {workers.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No workers available yet.</div>
                ) : (
                  workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}{w.trade ? ` · ${w.trade}` : ""}{w.company ? ` (${w.company})` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={saving || !workerId}
              onClick={async () => {
                if (await patch({ assignWorkerId: workerId }, "Worker assigned")) {
                  setOpen(false);
                  onSaved();
                }
              }}
            >
              Assign worker
            </Button>
          </div>

          <div className="h-px bg-border" />

          {/* Update + track status */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Update status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as MaintenanceStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(MaintenanceStatus).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Add a note for the tracker (optional)"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              disabled={saving}
              onClick={async () => {
                if (await patch({ status, note: note.trim() || undefined }, "Status updated")) {
                  setOpen(false);
                  onSaved();
                }
              }}
            >
              Save status
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ClientMaintenance({ properties }: { properties: ClientProperty[] }) {
  const [propertyId, setPropertyId] = React.useState<string>("ALL");
  const [items, setItems] = React.useState<MaintenanceListItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (propertyId !== "ALL") params.set("propertyId", propertyId);
    try {
      const res = await fetch(`/api/maintenance?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      setItems(Array.isArray(body.items) ? body.items : []);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const reportProperty = propertyId !== "ALL" ? propertyId : properties[0]?.id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="All properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}{p.suburb ? ` · ${p.suburb}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {reportProperty ? (
          <ReportMaintenanceSheet
            propertyId={reportProperty}
            triggerLabel="Report an item"
            triggerVariant="default"
            onReported={load}
          />
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Wrench className="h-6 w-6" />}
          title="Nothing flagged"
          body="When our team or you flag something on your Airbnb property that needs fixing or replacing, it shows up here with live status."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="rounded-xl">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.property?.name ?? ""}
                      {item.area ? ` · ${item.area}` : ""} · {CATEGORY_LABELS[item.category]}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={priorityTone(item.priority)}>{PRIORITY_LABELS[item.priority]}</Badge>
                    {item.status === "IN_PROGRESS" ? (
                      <Badge variant="default">Being handled</Badge>
                    ) : item.status === "RESOLVED" ? (
                      <Badge variant="success">Completed</Badge>
                    ) : (
                      <Badge variant={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Badge>
                    )}
                  </div>
                </div>
                {item.description ? (
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Recommended: {ACTION_LABELS[item.recommendedAction]}</span>
                  {item.photos && item.photos.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="h-3 w-3" /> {item.photos.length}
                    </span>
                  ) : null}
                </div>
                {item.photos && item.photos.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {item.photos.slice(0, 4).map((photo) => (
                      <a key={photo.key} href={photo.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt={item.title}
                          className="h-16 w-16 rounded-lg border border-border object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <ManageDialog item={item} onSaved={load} />
                </div>
                {item.status === "IN_PROGRESS" ? (
                  <p className="text-xs text-muted-foreground">Our maintenance team is handling this.</p>
                ) : null}
                {item.status === "RESOLVED" ? (
                  <div className="space-y-2">
                    {item.resolutionNote ? (
                      <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                        Completed{item.outcome ? ` · ${prettyOutcome(item.outcome)}` : ""}: {item.resolutionNote}
                      </p>
                    ) : item.outcome ? (
                      <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                        Completed · {prettyOutcome(item.outcome)}
                      </p>
                    ) : null}
                    <div className="pt-0.5">
                      <WorkDoneDialog item={item} />
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
