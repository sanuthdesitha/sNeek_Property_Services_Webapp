"use client";

/**
 * Estate cleaner lost & found. Rewritten onto the LostFoundItem model:
 *   POST /api/cleaner/lost-found  { jobId, itemName, location, notes, photos[] }
 *   GET  /api/cleaner/lost-found  → the cleaner's own reported items
 *   GET  /api/lost-found/:id      → item + timeline
 *   POST /api/lost-found/:id/events { action:"COMMENT", note } → add a comment
 *
 * A cleaner reports a found item (with stamped photos via the shared MediaCapture),
 * then can review everything they've reported, open the timeline, and comment.
 */
import * as React from "react";
import { PackageSearch, Clock, MessageSquare, RefreshCw } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaGallery } from "@/components/shared/media-gallery";
import { EModal } from "@/components/v2/admin/estate-kit";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";
import { toast } from "@/hooks/use-toast";
import {
  LOST_FOUND_STATUS_LABELS,
  LOST_FOUND_STATUS_TONES,
  LOST_FOUND_EVENT_LABELS,
  type LostFoundStatus,
} from "@/lib/lost-found/status";

interface JobOption {
  id: string;
  label: string;
}

type Photo = { url: string; key: string; caption?: string | null };

type ItemRow = {
  id: string;
  itemName: string;
  foundLocation: string | null;
  status: LostFoundStatus;
  propertyName: string | null;
  photos: Photo[];
  createdAt: string;
};

type TimelineEvent = {
  id: string;
  action: string;
  note: string | null;
  actorName: string | null;
  createdAt: string;
};

type ItemDetail = ItemRow & {
  description: string | null;
  resolution: string | null;
  events: TimelineEvent[];
};

function fmt(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function StatusBadge({ status }: { status: LostFoundStatus }) {
  return (
    <EBadge tone={LOST_FOUND_STATUS_TONES[status]} soft>
      {LOST_FOUND_STATUS_LABELS[status]}
    </EBadge>
  );
}

export function LostFoundForm({ jobs }: { jobs: JobOption[] }) {
  const [jobId, setJobId] = React.useState<string>(jobs[0]?.id ?? "");
  const [itemName, setItemName] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [photos, setPhotos] = React.useState<CapturedMedia[]>([]);
  const [saving, setSaving] = React.useState(false);

  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [loadingList, setLoadingList] = React.useState(true);

  const [detail, setDetail] = React.useState<ItemDetail | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [posting, setPosting] = React.useState(false);

  const loadList = React.useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/cleaner/lost-found", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load items.");
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e: any) {
      toast({ title: "Could not load", description: e?.message, variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
  }, []);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  async function submit() {
    if (!jobId || !itemName.trim()) {
      toast({ title: "Add a job and item name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/cleaner/lost-found", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          itemName: itemName.trim(),
          location: location.trim() || null,
          notes: notes.trim() || null,
          photos: photos.map((p) => ({ url: p.url, key: p.key })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed.");
      setItemName("");
      setLocation("");
      setNotes("");
      setPhotos([]);
      toast({
        title: "Item reported",
        description: body.notificationWarning ?? "Recorded and the office has been alerted.",
      });
      await loadList();
    } catch (e: any) {
      toast({ title: "Could not submit", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetail(null);
    setComment("");
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/lost-found/${id}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load item.");
      setDetail(body);
    } catch (e: any) {
      toast({ title: "Could not load item", description: e?.message, variant: "destructive" });
      setDetailOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function postComment() {
    if (!detail || !comment.trim()) {
      toast({ title: "Write a comment first", variant: "destructive" });
      return;
    }
    setPosting(true);
    try {
      const res = await fetch(`/api/lost-found/${detail.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "COMMENT", note: comment.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not comment.");
      setDetail(body);
      setComment("");
      toast({ title: "Comment added" });
    } catch (e: any) {
      toast({ title: "Comment failed", description: e?.message, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  }

  const stampContext = React.useMemo(
    () => ({ contextLabel: "Lost & Found", tag: "lost-found" }),
    []
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      {/* Report form */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Report a found item</ECardTitle>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Photograph and log the item so the office can reunite it with the guest.
          </p>
        </ECardHeader>
        <ECardBody className="space-y-4">
          <EField label="Job">
            <ESelect value={jobId} onChange={(e) => setJobId(e.target.value)}>
              {jobs.length === 0 ? <option value="">No assigned jobs</option> : null}
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.label}
                </option>
              ))}
            </ESelect>
          </EField>

          <EField label="Item name">
            <EInput placeholder="e.g. Silver watch" value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </EField>

          <EField label="Where found">
            <EInput
              placeholder="e.g. Master bedroom nightstand"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </EField>

          <EField label="Notes for admin / client">
            <ETextarea
              placeholder="Describe the item and any handling notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </EField>

          <EField label="Photos">
            <MediaCapture
              value={photos}
              onChange={setPhotos}
              mode="photo"
              folder="lost-found"
              multiple
              disabled={saving}
              stamp={stampContext}
            />
          </EField>

          <EButton
            variant="gold"
            className="w-full"
            onClick={() => void submit()}
            disabled={saving || jobs.length === 0}
          >
            <PackageSearch className="h-4 w-4" />
            {saving ? "Submitting…" : "Report found item"}
          </EButton>
        </ECardBody>
      </ECard>

      {/* My reported items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="e-eyebrow">MY REPORTED ITEMS</span>
          <EButton variant="ghost" size="sm" onClick={() => void loadList()} disabled={loadingList}>
            <RefreshCw className={loadingList ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </EButton>
        </div>
        {loadingList ? (
          <p className="py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : items.length === 0 ? (
          <EEmptyState
            eyebrow="Nothing yet"
            title="No items reported"
            description="Items you report appear here — tap one to follow its progress and comment."
          />
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <button key={it.id} type="button" className="w-full text-left" onClick={() => void openDetail(it.id)}>
                <ECard className="transition-colors hover:border-[hsl(var(--e-border-gold)/0.5)]">
                  <ECardBody className="space-y-1.5 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[0.9375rem] font-[550]">{it.itemName}</p>
                      <StatusBadge status={it.status} />
                    </div>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      {[it.foundLocation, it.propertyName].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <p className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      <Clock className="h-3 w-3" /> {fmt(it.createdAt)}
                      {it.photos.length > 0 ? ` · ${it.photos.length} photo${it.photos.length === 1 ? "" : "s"}` : ""}
                    </p>
                  </ECardBody>
                </ECard>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail + timeline modal */}
      <EModal open={detailOpen} onClose={() => setDetailOpen(false)} title={detail?.itemName ?? "Item"} eyebrow="Lost & found" wide>
        {loadingDetail || !detail ? (
          <p className="py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {[detail.foundLocation, detail.propertyName].filter(Boolean).join(" · ")}
              </span>
            </div>

            {detail.description ? (
              <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-foreground))]">{detail.description}</p>
            ) : null}

            {detail.photos.length > 0 ? (
              <MediaGallery
                items={detail.photos.map((p) => ({
                  id: p.key,
                  url: p.url,
                  mediaType: (p as any).mediaType,
                }))}
                title={detail.itemName}
                className="grid grid-cols-3 gap-2 sm:grid-cols-4"
              />
            ) : null}

            {/* Timeline */}
            <div className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
              <h3 className="flex items-center gap-1.5 text-[0.9375rem] font-semibold">
                <MessageSquare className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Timeline
              </h3>
              <div className="space-y-3">
                {detail.events.map((ev) => (
                  <div key={ev.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <EBadge tone="neutral" soft>
                        {LOST_FOUND_EVENT_LABELS[ev.action] ?? ev.action}
                      </EBadge>
                      <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {ev.actorName ?? "System"} · {fmt(ev.createdAt)}
                      </span>
                    </div>
                    {ev.note ? (
                      <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-foreground))]">{ev.note}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="space-y-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] p-3">
                <ETextarea
                  placeholder="Add a comment for the office"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <div className="flex justify-end">
                  <EButton size="sm" onClick={() => void postComment()} disabled={posting}>
                    {posting ? "Posting…" : "Add comment"}
                  </EButton>
                </div>
              </div>
            </div>
          </div>
        )}
      </EModal>
    </div>
  );
}
