"use client";

/**
 * Estate maintenance board (client) — same endpoints/payloads as the legacy
 * ClientMaintenance:
 *   GET   /api/maintenance[?propertyId]        → { items }
 *   POST  /api/maintenance  { propertyId, category, area?, title, description?, recommendedAction, priority, photoKeys? }
 *   GET   /api/maintenance/:id                 → { item } (finishPhotos, workerNote…)
 *   PATCH /api/maintenance/:id  { costDecision | assignWorkerId | status, note? }
 *   GET   /api/maintenance/workers             → { workers }
 *   POST  /api/maintenance/workers  { name, email?, phone?, trade?, company?, invite }
 *   POST  /api/uploads/direct  (multipart)     → { key, url }  (photo upload)
 * Styled purely with `--e-*` tokens. No v1 UI imports.
 */
import * as React from "react";
import { Wrench, Image as ImageIcon, Upload, X } from "lucide-react";
import {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
} from "@prisma/client";
import { EBadge, EButton, ECard, ECardBody, EEmptyState, EEyebrow } from "@/components/v2/ui/primitives";
import { EInput, ESelect, ETextarea, EField, EModal } from "@/components/v2/admin/estate-kit";
import { ECheckTile, EInlineNotice } from "@/components/v2/client/fields";
import { toast } from "@/hooks/use-toast";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from "@/lib/maintenance/labels";

const CATEGORIES = Object.values(MaintenanceCategory);
const ACTIONS = Object.values(MaintenanceAction);
const PRIORITIES = Object.values(MaintenancePriority);

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

function prettyOutcome(outcome: string): string {
  const lower = outcome.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
function priorityTone(p: MaintenancePriority): "danger" | "warning" | "primary" | "neutral" {
  return p === "URGENT" ? "danger" : p === "HIGH" ? "warning" : p === "MEDIUM" ? "primary" : "neutral";
}
function statusTone(s: MaintenanceStatus): "success" | "primary" | "warning" | "neutral" {
  switch (s) {
    case "RESOLVED":
      return "success";
    case "IN_PROGRESS":
    case "ACKNOWLEDGED":
      return "primary";
    case "ORDERED":
    case "OPEN":
      return "warning";
    default:
      return "neutral";
  }
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
  quotedCost?: number | null;
  costApprovalStatus?: string | null;
  property?: { name: string };
  photos?: Array<{ key: string; url: string }>;
}
interface MaintenanceItemDetail {
  status: MaintenanceStatus;
  outcome: string | null;
  workerNote: string | null;
  resolutionNote: string | null;
  finishPhotos?: Array<{ key: string; url: string }>;
}
type AssignableWorker = { id: string; name: string; trade: string | null; company: string | null };

/* ── Photo upload helper (via /api/uploads/direct) ─────────────────────── */
function usePhotoUpload() {
  const [keys, setKeys] = React.useState<Array<{ key: string; url: string }>>([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function upload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "maintenance");
        const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.key) throw new Error(body.error ?? `Could not upload ${file.name}.`);
        setKeys((prev) => [...prev, { key: String(body.key), url: String(body.url ?? "") }]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }
  function reset() {
    setKeys([]);
    setError(null);
  }
  return { keys, uploading, error, upload, reset, remove: (k: string) => setKeys((p) => p.filter((i) => i.key !== k)) };
}

/* ── Report a new item modal ───────────────────────────────────────────── */
function ReportModal({
  properties,
  defaultPropertyId,
  onReported,
}: {
  properties: ClientProperty[];
  defaultPropertyId?: string;
  onReported: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [propertyId, setPropertyId] = React.useState(defaultPropertyId ?? properties[0]?.id ?? "");
  const [category, setCategory] = React.useState<MaintenanceCategory>("OTHER");
  const [area, setArea] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [recommendedAction, setRecommendedAction] = React.useState<MaintenanceAction>("REPLACE");
  const [priority, setPriority] = React.useState<MaintenancePriority>("MEDIUM");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const photos = usePhotoUpload();

  React.useEffect(() => {
    if (open) setPropertyId(defaultPropertyId ?? properties[0]?.id ?? "");
  }, [open, defaultPropertyId, properties]);

  function reset() {
    setCategory("OTHER");
    setArea("");
    setTitle("");
    setDescription("");
    setRecommendedAction("REPLACE");
    setPriority("MEDIUM");
    setError(null);
    photos.reset();
  }

  async function submit() {
    if (!propertyId) {
      setError("Choose a property.");
      return;
    }
    if (!title.trim()) {
      setError("Add a short title describing the item.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          category,
          area: area.trim() || undefined,
          title: title.trim(),
          description: description.trim() || undefined,
          recommendedAction,
          priority,
          photoKeys: photos.keys.length > 0 ? photos.keys.map((p) => p.key) : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not submit.");
        return;
      }
      toast({ title: "Reported", description: "Added to the maintenance tracker." });
      reset();
      setOpen(false);
      onReported();
    } catch {
      setError("Network error. Please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <EButton onClick={() => setOpen(true)}>
        <Wrench className="h-4 w-4" />
        Report an item
      </EButton>
      <EModal open={open} onClose={() => setOpen(false)} title="Report something to fix or replace" eyebrow="Maintenance" wide>
        <div className="space-y-4">
          <EField label="Property">
            <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.suburb ? ` · ${p.suburb}` : ""}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="What needs attention?">
            <EInput
              value={title}
              maxLength={180}
              placeholder="e.g. Cracked bedside lamp"
              onChange={(e) => setTitle(e.target.value)}
            />
          </EField>
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Category">
              <ESelect value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Area / room">
              <EInput value={area} maxLength={120} placeholder="e.g. Master bedroom" onChange={(e) => setArea(e.target.value)} />
            </EField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Recommended action">
              <ESelect value={recommendedAction} onChange={(e) => setRecommendedAction(e.target.value as MaintenanceAction)}>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Priority">
              <ESelect value={priority} onChange={(e) => setPriority(e.target.value as MaintenancePriority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </ESelect>
            </EField>
          </div>
          <EField label="Details (optional)">
            <ETextarea
              rows={4}
              maxLength={6000}
              placeholder="What's wrong, how bad, anything the team should know."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </EField>
          <EField label="Photos (optional)">
            <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={photos.uploading}
                  onChange={(e) => {
                    void photos.upload(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
                <Upload className="mr-2 h-4 w-4" />
                {photos.uploading ? "Uploading…" : "Upload photos"}
              </label>
              {photos.error ? <EInlineNotice tone="danger">{photos.error}</EInlineNotice> : null}
              {photos.keys.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {photos.keys.map((p) => (
                    <span key={p.key} className="relative block h-16 w-16 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => photos.remove(p.key)}
                        className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center bg-[hsl(160_18%_8%/0.6)] text-white"
                        aria-label="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </EField>
          {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
          <div className="flex justify-end gap-2 pt-1">
            <EButton variant="outline" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </EButton>
            <EButton size="sm" onClick={() => void submit()} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit report"}
            </EButton>
          </div>
        </div>
      </EModal>
    </>
  );
}

/* ── Add a maintenance person modal ────────────────────────────────────── */
function AddWorkerModal() {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", email: "", phone: "", trade: "", company: "" });
  const [invite, setInvite] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  async function save() {
    if (!form.name.trim()) {
      setError("Enter the person's name.");
      return;
    }
    if (invite && !form.email.trim()) {
      setError("An email is required to send a portal invite.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          trade: form.trade.trim() || undefined,
          company: form.company.trim() || undefined,
          invite,
        }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(b.error ?? "Could not add.");
        return;
      }
      toast({
        title: "Maintenance person added",
        description: invite
          ? b.invitationEmailSent
            ? "A portal invite has been emailed to them."
            : "Saved — invite email couldn't be sent; an admin can resend it."
          : "You can now assign them to your items.",
      });
      setOpen(false);
      setForm({ name: "", email: "", phone: "", trade: "", company: "" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <EButton variant="outline" onClick={() => setOpen(true)}>
        <Wrench className="h-4 w-4" />
        Add a person
      </EButton>
      <EModal open={open} onClose={() => setOpen(false)} title="Add a maintenance person" eyebrow="Maintenance">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <EField label="Name *">
              <EInput value={form.name} onChange={(e) => set("name", e.target.value)} />
            </EField>
            <EField label="Trade">
              <EInput value={form.trade} onChange={(e) => set("trade", e.target.value)} placeholder="e.g. Plumber" />
            </EField>
          </div>
          <EField label={`Email${invite ? " *" : ""}`}>
            <EInput type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </EField>
          <div className="grid grid-cols-2 gap-3">
            <EField label="Phone">
              <EInput value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </EField>
            <EField label="Company">
              <EInput value={form.company} onChange={(e) => set("company", e.target.value)} />
            </EField>
          </div>
          <ECheckTile checked={invite} onChange={setInvite}>
            Invite them to the maintenance portal (emails a secure set-password link so they can manage assigned jobs).
          </ECheckTile>
          {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
          <EButton className="w-full" onClick={() => void save()} disabled={saving}>
            {saving ? "Adding…" : "Add maintenance person"}
          </EButton>
        </div>
      </EModal>
    </>
  );
}

/* ── Manage item modal (assign worker + update status) ─────────────────── */
function ManageModal({ item, onSaved }: { item: MaintenanceListItem; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [workers, setWorkers] = React.useState<AssignableWorker[]>([]);
  const [workerId, setWorkerId] = React.useState("");
  const [status, setStatus] = React.useState<MaintenanceStatus>(item.status);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setStatus(item.status);
    setWorkerId("");
    setNote("");
    setError(null);
    fetch("/api/maintenance/workers", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((b) => setWorkers(Array.isArray(b.workers) ? b.workers : []));
  }, [open, item.status]);

  async function patch(payload: Record<string, unknown>, successTitle: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(b.error ?? "Could not update.");
        return false;
      }
      toast({ title: successTitle });
      return true;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <EButton type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Wrench className="h-3.5 w-3.5" />
        Manage
      </EButton>
      <EModal open={open} onClose={() => setOpen(false)} title={`Manage — ${item.title}`} eyebrow="Maintenance">
        <div className="space-y-5">
          <div className="space-y-2">
            <EField label="Assign a maintenance person">
              <ESelect value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
                <option value="">Choose a worker…</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.trade ? ` · ${w.trade}` : ""}
                    {w.company ? ` (${w.company})` : ""}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EButton
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
            </EButton>
          </div>

          <div className="h-px bg-[hsl(var(--e-border))]" />

          <div className="space-y-2">
            <EField label="Update status">
              <ESelect value={status} onChange={(e) => setStatus(e.target.value as MaintenanceStatus)}>
                {Object.values(MaintenanceStatus).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </ESelect>
            </EField>
            <ETextarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note (optional)" />
            <EButton
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
            </EButton>
          </div>
          {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
        </div>
      </EModal>
    </>
  );
}

/* ── Work-done modal ───────────────────────────────────────────────────── */
function WorkDoneModal({ item }: { item: MaintenanceListItem }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [detail, setDetail] = React.useState<MaintenanceItemDetail | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/maintenance/${item.id}`, { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((b) => {
        if (cancelled) return;
        setDetail(b?.item ?? null);
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
    <>
      <EButton type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Wrench className="h-3.5 w-3.5" />
        View work done
      </EButton>
      <EModal open={open} onClose={() => setOpen(false)} title={`Work done — ${item.title}`} eyebrow="Maintenance" wide>
        {loading ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : (
          <div className="space-y-3">
            {outcome ? (
              <div className="flex items-center gap-2 text-[0.875rem]">
                <span className="text-[hsl(var(--e-muted-foreground))]">Outcome:</span>
                <EBadge tone="success" soft>
                  {prettyOutcome(outcome)}
                </EBadge>
              </div>
            ) : null}
            {note ? (
              <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.875rem]">{note}</p>
            ) : null}
            <div>
              <EEyebrow className="mb-2">Completed work</EEyebrow>
              {finishPhotos.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {finishPhotos.map((p) => (
                    <a
                      key={p.key}
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-square overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No completion photos.</p>
              )}
            </div>
          </div>
        )}
      </EModal>
    </>
  );
}

/* ── Cost approval inline ──────────────────────────────────────────────── */
function CostApproval({ item, onSaved }: { item: MaintenanceListItem; onSaved: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const status = item.costApprovalStatus ?? null;
  const cost = item.quotedCost ?? null;
  if (!status || cost == null) return null;

  async function decide(decision: "APPROVED" | "DECLINED") {
    setBusy(true);
    try {
      const res = await fetch(`/api/maintenance/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costDecision: decision }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not save", description: b.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: decision === "APPROVED" ? "Quote approved" : "Quote declined" });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  if (status === "PENDING") {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-[var(--e-radius-lg)] border-l-[3px] p-3"
        style={{ backgroundColor: "hsl(var(--e-warning-soft))", borderColor: "hsl(var(--e-warning))" }}
      >
        <div>
          <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-foreground))]">Approval needed</p>
          <p className="e-numeral text-[1.25rem] text-[hsl(var(--e-foreground))]">{money(cost)}</p>
        </div>
        <div className="flex gap-2">
          <EButton size="sm" variant="outline" disabled={busy} onClick={() => decide("DECLINED")}>
            Decline
          </EButton>
          <EButton size="sm" disabled={busy} onClick={() => decide("APPROVED")}>
            Approve
          </EButton>
        </div>
      </div>
    );
  }
  return (
    <EBadge tone={status === "APPROVED" ? "success" : "danger"} soft>
      {status === "APPROVED" ? "Quote approved" : "Quote declined"} · {money(cost)}
    </EBadge>
  );
}

/* ── Board ─────────────────────────────────────────────────────────────── */
export function MaintenanceBoard({ properties }: { properties: ClientProperty[] }) {
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
        <div className="w-64 max-w-full">
          <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="ALL">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.suburb ? ` · ${p.suburb}` : ""}
              </option>
            ))}
          </ESelect>
        </div>
        <div className="flex items-center gap-2">
          <AddWorkerModal />
          {reportProperty ? (
            <ReportModal properties={properties} defaultPropertyId={reportProperty} onReported={load} />
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
      ) : items.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing flagged"
          title="No open items"
          description="When our team or you flag something on your Airbnb property that needs fixing or replacing, it shows up here with live status."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ECard key={item.id}>
              <ECardBody className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-[550] text-[hsl(var(--e-foreground))]">{item.title}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {item.property?.name ?? ""}
                      {item.area ? ` · ${item.area}` : ""} · {CATEGORY_LABELS[item.category]}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <EBadge tone={priorityTone(item.priority)} soft>
                      {PRIORITY_LABELS[item.priority]}
                    </EBadge>
                    <EBadge tone={statusTone(item.status)} soft>
                      {item.status === "IN_PROGRESS"
                        ? "Being handled"
                        : item.status === "RESOLVED"
                          ? "Completed"
                          : STATUS_LABELS[item.status]}
                    </EBadge>
                  </div>
                </div>
                {item.description ? (
                  <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{item.description}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
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
                      <a key={photo.key} href={photo.url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt={item.title}
                          className="h-16 w-16 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}
                <CostApproval item={item} onSaved={load} />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <ManageModal item={item} onSaved={load} />
                </div>
                {item.status === "IN_PROGRESS" ? (
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Our maintenance team is handling this.</p>
                ) : null}
                {item.status === "RESOLVED" ? (
                  <div className="space-y-2">
                    {item.resolutionNote ? (
                      <p
                        className="rounded-[var(--e-radius)] px-3 py-2 text-[0.75rem]"
                        style={{ backgroundColor: "hsl(var(--e-success-soft))", color: "hsl(var(--e-success))" }}
                      >
                        Completed{item.outcome ? ` · ${prettyOutcome(item.outcome)}` : ""}: {item.resolutionNote}
                      </p>
                    ) : item.outcome ? (
                      <p
                        className="rounded-[var(--e-radius)] px-3 py-2 text-[0.75rem]"
                        style={{ backgroundColor: "hsl(var(--e-success-soft))", color: "hsl(var(--e-success))" }}
                      >
                        Completed · {prettyOutcome(item.outcome)}
                      </p>
                    ) : null}
                    <WorkDoneModal item={item} />
                  </div>
                ) : null}
              </ECardBody>
            </ECard>
          ))}
        </div>
      )}
    </div>
  );
}
