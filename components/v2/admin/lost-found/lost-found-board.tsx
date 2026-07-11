"use client";

/**
 * ESTATE — Admin lost & found board. Full workflow over the LostFoundItem model:
 *   GET   /api/admin/lost-found?status&propertyId&from&to&q → { items, openCount, properties }
 *   GET   /api/lost-found/:id                               → item + timeline
 *   POST  /api/lost-found/:id/events { action, note, guest… } comment / offer / guest-contacted
 *   PATCH /api/lost-found/:id        { status, guestName, guestContact, resolution } status + resolve
 *
 * Zero v1 UI imports — Estate primitives + estate-kit only.
 */
import * as React from "react";
import {
  PackageSearch,
  RefreshCw,
  Search,
  MessageSquare,
  Clock,
  X,
  Gift,
  Trash2,
  HandHelping,
  Phone,
  Archive,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea, EModal } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";
import {
  LOST_FOUND_STATUSES,
  LOST_FOUND_STATUS_LABELS,
  LOST_FOUND_STATUS_TONES,
  LOST_FOUND_EVENT_LABELS,
  WORKFLOW_STATUSES,
  RESOLVED_STATUSES,
  type LostFoundStatus,
} from "@/lib/lost-found/status";

type Photo = { url: string; key: string; caption?: string | null };

type ItemRow = {
  id: string;
  itemName: string;
  foundLocation: string | null;
  status: LostFoundStatus;
  propertyId: string | null;
  propertyName: string | null;
  guestName: string | null;
  reportedByName: string | null;
  photos: Photo[];
  estimatedValue: number | null;
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
  guestContact: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  jobNumber: string | null;
  events: TimelineEvent[];
};

type PropertyOption = { id: string; name: string };

function fmt(value?: string | null) {
  if (!value) return "—";
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

const RESOLVE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  RETURNED: { label: "Returned to guest", icon: <HandHelping className="h-4 w-4" /> },
  DONATED: { label: "Donated", icon: <Gift className="h-4 w-4" /> },
  DISPOSED: { label: "Disposed", icon: <Trash2 className="h-4 w-4" /> },
  UNCLAIMED: { label: "Unclaimed", icon: <Archive className="h-4 w-4" /> },
};

export function LostFoundBoard() {
  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [openCount, setOpenCount] = React.useState(0);
  const [loadingList, setLoadingList] = React.useState(true);

  const [filters, setFilters] = React.useState({ status: "ALL", propertyId: "ALL", from: "", to: "", q: "" });

  const [detail, setDetail] = React.useState<ItemDetail | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [comment, setComment] = React.useState("");
  const [guestName, setGuestName] = React.useState("");
  const [guestContact, setGuestContact] = React.useState("");
  const [statusDraft, setStatusDraft] = React.useState<LostFoundStatus>("IN_STORAGE");

  const [resolveWith, setResolveWith] = React.useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = React.useState("");
  const [lightbox, setLightbox] = React.useState<string | null>(null);

  const loadList = React.useCallback(async () => {
    setLoadingList(true);
    try {
      const query = new URLSearchParams();
      if (filters.status !== "ALL") query.set("status", filters.status);
      if (filters.propertyId !== "ALL") query.set("propertyId", filters.propertyId);
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
      if (filters.q.trim()) query.set("q", filters.q.trim());
      const res = await fetch(`/api/admin/lost-found?${query.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load items.");
      setItems(Array.isArray(body.items) ? body.items : []);
      setProperties(Array.isArray(body.properties) ? body.properties : []);
      setOpenCount(Number(body.openCount ?? 0));
    } catch (e: any) {
      toast({ title: "Lost & found failed", description: e?.message, variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
  }, [filters.status, filters.propertyId, filters.from, filters.to, filters.q]);

  React.useEffect(() => {
    const t = setTimeout(() => void loadList(), 180);
    return () => clearTimeout(t);
  }, [loadList]);

  function syncDraftsFrom(d: ItemDetail) {
    setGuestName(d.guestName ?? "");
    setGuestContact(d.guestContact ?? "");
    setStatusDraft((WORKFLOW_STATUSES as readonly string[]).includes(d.status) ? d.status : "IN_STORAGE");
  }

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetail(null);
    setComment("");
    setResolveWith(null);
    setResolutionNote("");
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/lost-found/${id}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load item.");
      setDetail(body);
      syncDraftsFrom(body);
    } catch (e: any) {
      toast({ title: "Could not load", description: e?.message, variant: "destructive" });
      setDetailOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  }

  function applyResult(body: ItemDetail) {
    setDetail(body);
    syncDraftsFrom(body);
    setItems((cur) => cur.map((r) => (r.id === body.id ? { ...r, ...body } : r)));
  }

  async function postEvent(action: "COMMENT" | "OFFER_RETURN" | "GUEST_CONTACTED", payload?: Record<string, unknown>) {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lost-found/${detail.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Action failed.");
      applyResult(body);
      await loadList();
      return true;
    } catch (e: any) {
      toast({ title: "Action failed", description: e?.message, variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function patch(payload: Record<string, unknown>, successTitle: string) {
    if (!detail) return false;
    setBusy(true);
    try {
      const res = await fetch(`/api/lost-found/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Update failed.");
      applyResult(body);
      await loadList();
      toast({ title: successTitle });
      return true;
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message, variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addComment() {
    if (!comment.trim()) {
      toast({ title: "Write a comment first", variant: "destructive" });
      return;
    }
    if (await postEvent("COMMENT", { note: comment.trim() })) {
      setComment("");
      toast({ title: "Comment added" });
    }
  }

  async function doResolve() {
    if (!resolveWith) return;
    const ok = await patch(
      { status: resolveWith, resolution: resolutionNote.trim() || null },
      `Marked ${RESOLVE_META[resolveWith]?.label ?? resolveWith}`
    );
    if (ok) {
      setResolveWith(null);
      setResolutionNote("");
    }
  }

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Lost & found"
        description="Every item a cleaner reports, from storage through to the final decision."
        actions={
          <>
            <EBadge tone={openCount > 0 ? "warning" : "success"} soft>
              {openCount} open
            </EBadge>
            <EButton variant="outline" onClick={() => void loadList()} disabled={loadingList}>
              <RefreshCw className={loadingList ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </EButton>
          </>
        }
      />

      {/* Filters */}
      <ECard>
        <ECardBody className="grid gap-3 py-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
            <EInput
              className="pl-9"
              placeholder="Search item, location, guest…"
              value={filters.q}
              onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
            />
          </div>
          <ESelect value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
            <option value="ALL">All statuses</option>
            {LOST_FOUND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LOST_FOUND_STATUS_LABELS[s]}
              </option>
            ))}
          </ESelect>
          <ESelect value={filters.propertyId} onChange={(e) => setFilters((p) => ({ ...p, propertyId: e.target.value }))}>
            <option value="ALL">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </ESelect>
          <div className="grid grid-cols-2 gap-2">
            <EInput type="date" value={filters.from} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
            <EInput type="date" value={filters.to} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
          </div>
        </ECardBody>
      </ECard>

      {/* Board */}
      {loadingList ? (
        <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading items…</p>
      ) : items.length === 0 ? (
        <EEmptyState
          eyebrow="Lost & found"
          title="No items match"
          description="Adjust the filters, or wait for cleaners to report found items."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => (
            <button key={it.id} type="button" className="text-left" onClick={() => void openDetail(it.id)}>
              <ECard className="h-full transition-colors hover:border-[hsl(var(--e-border-gold)/0.5)]">
                <ECardBody className="space-y-2 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-[0.9375rem] font-[550]">{it.itemName}</p>
                    <StatusBadge status={it.status} />
                  </div>
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {[it.foundLocation, it.propertyName].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      <Clock className="h-3 w-3" /> {fmt(it.createdAt)}
                    </span>
                    {it.photos.length > 0 ? (
                      <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                        {it.photos.length} photo{it.photos.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  {it.reportedByName ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Reported by {it.reportedByName}</p>
                  ) : null}
                </ECardBody>
              </ECard>
            </button>
          ))}
        </div>
      )}

      {/* Detail drawer */}
      <EModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail?.itemName ?? "Item"}
        eyebrow="Lost & found"
        size="xl"
      >
        {loadingDetail || !detail ? (
          <p className="py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            {/* Left: item + timeline */}
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={detail.status} />
                <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {[detail.foundLocation, detail.propertyName].filter(Boolean).join(" · ")}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                <span>Reported {fmt(detail.createdAt)}</span>
                {detail.reportedByName ? <span>By {detail.reportedByName}</span> : null}
                {detail.jobNumber ? <span>Job {detail.jobNumber}</span> : null}
                {detail.estimatedValue != null ? <span>Est. ${detail.estimatedValue.toFixed(2)}</span> : null}
              </div>

              {detail.description ? (
                <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-foreground))]">{detail.description}</p>
              ) : null}

              {detail.photos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {detail.photos.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setLightbox(p.url)}
                      className="aspect-square overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={detail.itemName} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}

              {detail.resolvedAt ? (
                <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.8125rem]">
                  <p className="font-[550]">Resolved {fmt(detail.resolvedAt)}{detail.resolvedByName ? ` by ${detail.resolvedByName}` : ""}</p>
                  {detail.resolution ? (
                    <p className="mt-1 whitespace-pre-wrap text-[hsl(var(--e-muted-foreground))]">{detail.resolution}</p>
                  ) : null}
                </div>
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
                  <ETextarea placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
                  <div className="flex justify-end">
                    <EButton size="sm" onClick={() => void addComment()} disabled={busy}>
                      Add comment
                    </EButton>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: actions */}
            <div className="space-y-4">
              {/* Guest details */}
              <ECard>
                <ECardHeader className="p-4 pb-0">
                  <ECardTitle className="text-[0.9375rem]">Guest details</ECardTitle>
                </ECardHeader>
                <ECardBody className="space-y-3 p-4">
                  <EField label="Guest name">
                    <EInput value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Name on the booking" />
                  </EField>
                  <EField label="Guest contact">
                    <ETextarea
                      value={guestContact}
                      onChange={(e) => setGuestContact(e.target.value)}
                      placeholder="Email / phone (recorded only — no guest emails sent)"
                    />
                  </EField>
                  <div className="flex flex-wrap gap-2">
                    <EButton
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void patch({ guestName: guestName || null, guestContact: guestContact || null }, "Guest details saved")}
                    >
                      Save details
                    </EButton>
                    <EButton
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void postEvent("GUEST_CONTACTED", { guestName: guestName || null, guestContact: guestContact || null }).then(
                          (ok) => ok && toast({ title: "Marked guest contacted" })
                        )
                      }
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Mark contacted
                    </EButton>
                  </div>
                </ECardBody>
              </ECard>

              {/* Status controls */}
              <ECard>
                <ECardHeader className="p-4 pb-0">
                  <ECardTitle className="text-[0.9375rem]">Move through workflow</ECardTitle>
                </ECardHeader>
                <ECardBody className="space-y-3 p-4">
                  <EField label="Set status">
                    <ESelect value={statusDraft} onChange={(e) => setStatusDraft(e.target.value as LostFoundStatus)}>
                      {WORKFLOW_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LOST_FOUND_STATUS_LABELS[s]}
                        </option>
                      ))}
                      <option value="ARCHIVED">{LOST_FOUND_STATUS_LABELS.ARCHIVED}</option>
                    </ESelect>
                  </EField>
                  <div className="flex flex-wrap gap-2">
                    <EButton
                      size="sm"
                      disabled={busy || statusDraft === detail.status}
                      onClick={() => void patch({ status: statusDraft }, "Status updated")}
                    >
                      Update status
                    </EButton>
                    <EButton
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void postEvent("OFFER_RETURN").then((ok) => ok && toast({ title: "Return offered" }))}
                    >
                      <Gift className="h-3.5 w-3.5" />
                      Offer return
                    </EButton>
                  </div>
                </ECardBody>
              </ECard>

              {/* Resolve */}
              <ECard variant="ceremony">
                <ECardHeader className="p-4 pb-0">
                  <ECardTitle className="text-[0.9375rem]">Record the final decision</ECardTitle>
                </ECardHeader>
                <ECardBody className="space-y-3 p-4">
                  {resolveWith ? (
                    <div className="space-y-3">
                      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                        Marking this item <span className="font-[550] text-[hsl(var(--e-foreground))]">{RESOLVE_META[resolveWith]?.label}</span>.
                      </p>
                      <ETextarea
                        placeholder="Resolution note (e.g. couriered to guest, held 90 days)"
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <EButton size="sm" variant="outline" onClick={() => setResolveWith(null)} disabled={busy}>
                          Cancel
                        </EButton>
                        <EButton size="sm" variant="gold" onClick={() => void doResolve()} disabled={busy}>
                          Confirm {RESOLVE_META[resolveWith]?.label}
                        </EButton>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {RESOLVED_STATUSES.map((s) => (
                        <EButton
                          key={s}
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setResolveWith(s);
                            setResolutionNote("");
                          }}
                        >
                          {RESOLVE_META[s]?.icon}
                          {RESOLVE_META[s]?.label}
                        </EButton>
                      ))}
                    </div>
                  )}
                </ECardBody>
              </ECard>
            </div>
          </div>
        )}
      </EModal>

      {/* Lightbox */}
      {lightbox ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[hsl(160_18%_8%/0.8)] p-6"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/30 text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-[90vh] max-w-[90vw] rounded-[var(--e-radius)] object-contain" />
        </div>
      ) : null}
    </div>
  );
}
