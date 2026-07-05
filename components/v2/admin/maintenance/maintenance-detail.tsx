"use client";

/**
 * ESTATE — Admin maintenance detail (native v2 port of
 * components/maintenance/admin-maintenance-detail). Full record: photos, client
 * quote, visit progress, worker location (link-out), event history, and the
 * assign / reassign flow with an inline "add ad-hoc worker" form + portal-login
 * promotion.
 *
 * Endpoints (unchanged from v1):
 *   GET   /api/maintenance/:id                                      → { item }
 *   PATCH /api/maintenance/:id                { quotedCost }        (send client quote)
 *   GET   /api/admin/maintenance/workers                           → { workers }
 *   POST  /api/admin/maintenance/workers      { name, phone?, ... } → { ok, id }
 *   GET   /api/admin/users                                         → AppUser[]
 *   POST  /api/admin/maintenance/:id/assign   { workerId, scheduledFor, shareAccess, contactPersonUserId }
 *   POST  /api/admin/maintenance/workers/:id/promote              → { ok, invitationLink? }
 */

import * as React from "react";
import Link from "next/link";
import {
  Wrench,
  ArrowLeft,
  AlertTriangle,
  Loader2,
  Plus,
  UserPlus,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  CalendarClock,
  ImageIcon,
  History,
  ClipboardList,
  KeyRound,
  Route,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  MaintenanceStatus,
} from "@prisma/client";
import { googleMapsDirectionsUrl } from "@/lib/maps/google-maps-url";
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
  ECardHeader,
  ECardTitle,
  ECardBody,
  EBadge,
  EPageHeader,
  EAlert,
} from "@/components/v2/ui/primitives";
import { EInput, EField, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";

// ─── Estate tone helpers ─────────────────────────────────────────────────────
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

// ─── Types ───────────────────────────────────────────────────────────────────
interface Photo {
  key: string;
  url: string;
}
interface Ping {
  id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  kind: string | null;
  createdAt: string;
}
interface Worker {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  trade: string | null;
  company: string | null;
  isPermanent: boolean;
  userId: string | null;
}
interface MaintenanceEvent {
  id: string;
  fromStatus: MaintenanceStatus | null;
  toStatus: MaintenanceStatus;
  note: string | null;
  createdAt: string;
  user: { name: string | null; email: string | null; role: string } | null;
}
interface ContactPerson {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}
interface PropertyDetail {
  id: string;
  name: string;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  accessCode: string | null;
  alarmCode: string | null;
  keyLocation: string | null;
  accessNotes: string | null;
  accessInfo: string | null;
  client: { name: string | null; email: string | null; phone: string | null } | null;
}
interface MaintenanceDetailItem {
  id: string;
  title: string;
  description: string | null;
  category: MaintenanceCategory;
  area: string | null;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  source?: MaintenanceSource;
  recommendedAction: keyof typeof ACTION_LABELS;
  estimatedCost: number | null;
  quotedCost: number | null;
  costApprovalStatus: string | null;
  costDecidedAt: string | null;
  clientVisible: boolean;
  photos: Photo[];
  finishPhotos: Photo[];
  outcome: string | null;
  workerNote: string | null;
  issuesNote: string | null;
  scheduledFor: string | null;
  shareAccess: boolean;
  enRouteAt: string | null;
  arrivedAt: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  resolvedAt: string | null;
  assignedWorker: Worker | null;
  assignedBy?: { name: string | null } | null;
  contactPerson: ContactPerson | null;
  pings: Ping[];
  events: MaintenanceEvent[];
  property: PropertyDetail;
  reportedBy?: { name: string | null; email: string | null; role: string } | null;
  createdAt?: string;
}
interface AppUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  phone: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
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
function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}
function fullAddress(p: PropertyDetail): string {
  return [p.address, p.suburb, [p.state, p.postcode].filter(Boolean).join(" ")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

const NONE = "__none__";

// ─── Native photo gallery + lightbox ─────────────────────────────────────────
function EGallery({ photos, emptyText }: { photos: Photo[]; emptyText?: string }) {
  const [index, setIndex] = React.useState<number | null>(null);
  const count = photos.length;

  const go = React.useCallback(
    (delta: number) => setIndex((i) => (i === null ? null : (i + delta + count) % count)),
    [count]
  );

  React.useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIndex(null);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go]);

  if (count === 0) {
    return (
      <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        {emptyText ?? "No photos."}
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {photos.map((p, i) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setIndex(i)}
            className="aspect-square overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {index !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(160_18%_8%/0.8)] p-4"
          onClick={() => setIndex(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setIndex(null)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/30 text-white"
          >
            <X className="h-4 w-4" />
          </button>
          {count > 1 ? (
            <button
              type="button"
              aria-label="Previous"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/30 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[index].url}
            alt=""
            className="max-h-[85vh] max-w-[90vw] rounded-[var(--e-radius-lg)] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {count > 1 ? (
            <button
              type="button"
              aria-label="Next"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              className="absolute right-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/30 text-white"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export function EstateMaintenanceDetail({ itemId }: { itemId: string }) {
  const [item, setItem] = React.useState<MaintenanceDetailItem | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [workers, setWorkers] = React.useState<Worker[]>([]);
  const [users, setUsers] = React.useState<AppUser[]>([]);

  // Assignment form state
  const [workerId, setWorkerId] = React.useState<string>("");
  const [scheduledFor, setScheduledFor] = React.useState<string>("");
  const [shareAccess, setShareAccess] = React.useState(false);
  const [contactPersonUserId, setContactPersonUserId] = React.useState<string>(NONE);
  const [assigning, setAssigning] = React.useState(false);
  const [reassigning, setReassigning] = React.useState(false);
  const [promoting, setPromoting] = React.useState(false);

  // New worker mini-form
  const [showNewWorker, setShowNewWorker] = React.useState(false);
  const [nwName, setNwName] = React.useState("");
  const [nwPhone, setNwPhone] = React.useState("");
  const [nwEmail, setNwEmail] = React.useState("");
  const [nwTrade, setNwTrade] = React.useState("");
  const [nwCompany, setNwCompany] = React.useState("");
  const [creatingWorker, setCreatingWorker] = React.useState(false);

  // Client cost quote
  const [quoteInput, setQuoteInput] = React.useState("");
  const [savingQuote, setSavingQuote] = React.useState(false);

  const loadItem = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/maintenance/${itemId}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not load this maintenance item.");
        return;
      }
      const loaded: MaintenanceDetailItem = body.item;
      setItem(loaded);
      setError(null);
      setWorkerId(loaded.assignedWorker?.id ?? "");
      setScheduledFor(toLocalInput(loaded.scheduledFor));
      setShareAccess(Boolean(loaded.shareAccess));
      setContactPersonUserId(loaded.contactPerson?.id ?? NONE);
    } catch {
      setError("Could not load this maintenance item.");
    }
  }, [itemId]);

  const loadWorkers = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/maintenance/workers", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      setWorkers(Array.isArray(body.workers) ? body.workers : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadUsers = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      const list: AppUser[] = Array.isArray(body) ? body : [];
      setUsers(list.filter((u) => u.role === "ADMIN" || u.role === "OPS_MANAGER"));
    } catch {
      /* non-fatal */
    }
  }, []);

  React.useEffect(() => {
    setLoading(true);
    void Promise.all([loadItem(), loadWorkers(), loadUsers()]).finally(() => setLoading(false));
  }, [loadItem, loadWorkers, loadUsers]);

  async function sendQuote() {
    const amount = Number(quoteInput);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter a valid quote amount.");
      return;
    }
    setSavingQuote(true);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotedCost: amount }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not send quote. Please retry.");
        return;
      }
      setNotice("Quote sent for approval. The client can now approve or decline it.");
      setQuoteInput("");
      await loadItem();
    } finally {
      setSavingQuote(false);
    }
  }

  async function createWorker() {
    if (!nwName.trim()) {
      setError("Enter a name for the worker.");
      return;
    }
    setCreatingWorker(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/maintenance/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nwName.trim(),
          phone: nwPhone.trim() || undefined,
          email: nwEmail.trim() || undefined,
          trade: nwTrade.trim() || undefined,
          company: nwCompany.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Could not add worker. Please retry.");
        return;
      }
      await loadWorkers();
      if (body.id) setWorkerId(body.id);
      setShowNewWorker(false);
      setNwName("");
      setNwPhone("");
      setNwEmail("");
      setNwTrade("");
      setNwCompany("");
    } finally {
      setCreatingWorker(false);
    }
  }

  async function assign() {
    if (!workerId) {
      setError("Select a worker to assign.");
      return;
    }
    setAssigning(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/maintenance/${itemId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId,
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
          shareAccess,
          contactPersonUserId: contactPersonUserId === NONE ? null : contactPersonUserId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Could not assign. Please retry.");
        return;
      }
      setNotice("Worker assigned. The maintenance visit has been scheduled.");
      setReassigning(false);
      await loadItem();
    } finally {
      setAssigning(false);
    }
  }

  async function promote(worker: Worker) {
    setPromoting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/maintenance/workers/${worker.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Could not create login. Please retry.");
        return;
      }
      setNotice(
        body.invitationEmailSent
          ? "Portal login created — an invitation email was sent to the worker."
          : body.invitationLink
            ? `Portal login created. Invitation link: ${body.invitationLink}`
            : "Portal login created. Share their invitation manually."
      );
      await loadWorkers();
      await loadItem();
    } finally {
      setPromoting(false);
    }
  }

  // ─── Render states ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading maintenance item…
      </div>
    );
  }

  if (error && !item) {
    return (
      <div className="space-y-4">
        <Link
          href="/v2/admin/maintenance"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to maintenance
        </Link>
        <EAlert tone="danger" title="Could not load">
          {error ?? "Item not found."}
        </EAlert>
      </div>
    );
  }

  if (!item) return null;

  const worker = item.assignedWorker;
  const isAdHoc = worker ? worker.isPermanent === false || worker.userId == null : false;
  const directionsUrl = googleMapsDirectionsUrl(item.property);
  const firstPing = item.pings.length > 0 ? item.pings[0] : null;
  const lastPing = item.pings.length > 1 ? item.pings[item.pings.length - 1] : null;

  return (
    <div className="space-y-6">
      <Link
        href="/v2/admin/maintenance"
        className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to maintenance
      </Link>

      {error ? (
        <EAlert tone="danger" title="Something went wrong">
          {error}
        </EAlert>
      ) : null}
      {notice ? (
        <EAlert tone="success" title="Done">
          {notice}
        </EAlert>
      ) : null}

      <EPageHeader
        eyebrow="Maintenance"
        title={item.title}
        description={
          <span>
            {item.property.name}
            {fullAddress(item.property) ? ` · ${fullAddress(item.property)}` : ""}
          </span>
        }
      />

      {/* Status / meta badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        <EBadge tone={priorityTone(item.priority)} soft>
          {PRIORITY_LABELS[item.priority]}
        </EBadge>
        <EBadge tone={statusTone(item.status)} soft>
          {STATUS_LABELS[item.status]}
        </EBadge>
        <EBadge tone="neutral">{CATEGORY_LABELS[item.category]}</EBadge>
        <EBadge tone="gold" soft>
          {ACTION_LABELS[item.recommendedAction]}
        </EBadge>
        {!item.clientVisible ? <EBadge tone="neutral">Internal</EBadge> : null}
        {item.area ? <EBadge tone="neutral">{item.area}</EBadge> : null}
      </div>

      {/* Reported-by + cost */}
      <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        Reported by {item.reportedBy?.name ?? item.reportedBy?.email ?? "—"}
        {item.source ? ` (${SOURCE_LABELS[item.source]})` : ""}
        {item.createdAt ? ` · ${fmtDate(item.createdAt)}` : ""}
        {item.estimatedCost != null ? ` · Est. $${item.estimatedCost.toFixed(2)}` : ""}
      </p>

      {item.description ? (
        <ECard>
          <ECardBody className="p-5 text-[0.875rem] text-[hsl(var(--e-foreground))]">{item.description}</ECardBody>
        </ECard>
      ) : null}

      {/* Client cost quote + approval state */}
      <ECard>
        <ECardBody className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[0.875rem] font-medium text-[hsl(var(--e-foreground))]">Client quote</p>
            {item.costApprovalStatus === "APPROVED" ? (
              <EBadge tone="success" soft>
                Approved{item.quotedCost != null ? ` · $${item.quotedCost.toFixed(2)}` : ""}
              </EBadge>
            ) : item.costApprovalStatus === "DECLINED" ? (
              <EBadge tone="danger" soft>
                Declined{item.quotedCost != null ? ` · $${item.quotedCost.toFixed(2)}` : ""}
              </EBadge>
            ) : item.costApprovalStatus === "PENDING" ? (
              <EBadge tone="warning" soft>
                Awaiting client{item.quotedCost != null ? ` · $${item.quotedCost.toFixed(2)}` : ""}
              </EBadge>
            ) : null}
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Send a price to the owning client to approve or decline. Sending makes the item visible to them.
          </p>
          <div className="flex items-end gap-2">
            <EField label="Amount (AUD)" className="flex-1">
              <EInput
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder={item.quotedCost != null ? item.quotedCost.toFixed(2) : "0.00"}
                value={quoteInput}
                onChange={(e) => setQuoteInput(e.target.value)}
              />
            </EField>
            <EButton onClick={() => void sendQuote()} disabled={savingQuote}>
              {savingQuote ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {item.costApprovalStatus === "PENDING" ? "Update quote" : "Send for approval"}
            </EButton>
          </div>
        </ECardBody>
      </ECard>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left column ── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Reported photos */}
          <ECard>
            <ECardHeader>
              <ECardTitle className="flex items-center gap-2 text-[1rem]">
                <ImageIcon className="h-4 w-4" /> Reported photos
              </ECardTitle>
            </ECardHeader>
            <ECardBody>
              <EGallery photos={item.photos} emptyText="No photos were attached when this was reported." />
            </ECardBody>
          </ECard>

          {/* Finish photos */}
          {item.finishPhotos.length > 0 ? (
            <ECard>
              <ECardHeader>
                <ECardTitle className="flex items-center gap-2 text-[1rem]">
                  <CheckCircle2 className="h-4 w-4" /> Work completed photos
                </ECardTitle>
              </ECardHeader>
              <ECardBody>
                <EGallery photos={item.finishPhotos} />
              </ECardBody>
            </ECard>
          ) : null}

          {/* Visit progress */}
          <ECard>
            <ECardHeader>
              <ECardTitle className="flex items-center gap-2 text-[1rem]">
                <Route className="h-4 w-4" /> Visit progress
              </ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-[0.875rem] sm:grid-cols-3">
                <Stat label="Scheduled" value={fmtDate(item.scheduledFor)} />
                <Stat label="En route" value={fmtDate(item.enRouteAt)} />
                <Stat label="Arrived" value={fmtDate(item.arrivedAt)} />
                <Stat label="Clock in" value={fmtDate(item.clockInAt)} />
                <Stat label="Clock out" value={fmtDate(item.clockOutAt)} />
                <Stat label="Resolved" value={fmtDate(item.resolvedAt)} />
              </div>
              {item.outcome ? <NoteBlock label="Outcome" body={item.outcome} /> : null}
              {item.workerNote ? <NoteBlock label="Worker note" body={item.workerNote} /> : null}
              {item.issuesNote ? <NoteBlock label="Issues raised" body={item.issuesNote} /> : null}
            </ECardBody>
          </ECard>

          {/* Worker location (link-out, self-contained — no maps JS) */}
          {item.pings.length > 0 ? (
            <ECard>
              <ECardHeader>
                <ECardTitle className="flex items-center gap-2 text-[1rem]">
                  <MapPin className="h-4 w-4" /> Worker location
                </ECardTitle>
              </ECardHeader>
              <ECardBody className="space-y-2 text-[0.875rem]">
                {firstPing ? (
                  <PingRow
                    label="Check-in"
                    lat={firstPing.lat}
                    lng={firstPing.lng}
                    at={firstPing.createdAt}
                  />
                ) : null}
                {lastPing ? (
                  <PingRow label="Check-out" lat={lastPing.lat} lng={lastPing.lng} at={lastPing.createdAt} />
                ) : null}
                {directionsUrl ? (
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[hsl(var(--e-gold-ink))] hover:underline"
                  >
                    <MapPin className="h-3.5 w-3.5" /> Directions to property
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </a>
                ) : null}
              </ECardBody>
            </ECard>
          ) : null}

          {/* Event history */}
          <ECard>
            <ECardHeader>
              <ECardTitle className="flex items-center gap-2 text-[1rem]">
                <History className="h-4 w-4" /> Event history
              </ECardTitle>
            </ECardHeader>
            <ECardBody>
              {item.events.length === 0 ? (
                <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No events recorded yet.</p>
              ) : (
                <ol className="space-y-3 border-l-2 border-[hsl(var(--e-border))] pl-4">
                  {item.events.map((ev) => (
                    <li key={ev.id} className="relative">
                      <span className="absolute -left-[1.4rem] top-1 h-2 w-2 rounded-full bg-[hsl(var(--e-gold))]" />
                      <div className="flex flex-wrap items-center gap-1.5 text-[0.875rem]">
                        {ev.fromStatus ? (
                          <span className="text-[hsl(var(--e-muted-foreground))]">
                            {STATUS_LABELS[ev.fromStatus]} →
                          </span>
                        ) : null}
                        <EBadge tone={statusTone(ev.toStatus)} soft>
                          {STATUS_LABELS[ev.toStatus]}
                        </EBadge>
                      </div>
                      {ev.note ? (
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{ev.note}</p>
                      ) : null}
                      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                        {fmtDate(ev.createdAt)}
                        {ev.user?.name ? ` · ${ev.user.name}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </ECardBody>
          </ECard>
        </div>

        {/* ── Right column: assignment ── */}
        <div className="space-y-6">
          <ECard>
            <ECardHeader>
              <ECardTitle className="flex items-center gap-2 text-[1rem]">
                <ClipboardList className="h-4 w-4" /> Assignment
              </ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-4">
              {worker && !reassigning ? (
                <div className="space-y-3">
                  <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                    <p className="font-semibold text-[hsl(var(--e-foreground))]">{worker.name}</p>
                    {worker.trade || worker.company ? (
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {[worker.trade, worker.company].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-col gap-1.5 text-[0.875rem]">
                      {worker.phone ? (
                        <a
                          href={`tel:${worker.phone}`}
                          className="inline-flex items-center gap-1.5 text-[hsl(var(--e-gold-ink))] hover:underline"
                        >
                          <Phone className="h-3.5 w-3.5" /> {worker.phone}
                        </a>
                      ) : null}
                      {worker.email ? (
                        <a
                          href={`mailto:${worker.email}`}
                          className="inline-flex items-center gap-1.5 text-[hsl(var(--e-gold-ink))] hover:underline"
                        >
                          <Mail className="h-3.5 w-3.5" /> {worker.email}
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {item.scheduledFor ? (
                    <p className="flex items-center gap-1.5 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                      <CalendarClock className="h-3.5 w-3.5" /> Scheduled for {fmtDate(item.scheduledFor)}
                    </p>
                  ) : null}
                  {item.contactPerson ? (
                    <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                      Contact: {item.contactPerson.name ?? item.contactPerson.email ?? "—"}
                    </p>
                  ) : null}
                  <p className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <KeyRound className="h-3.5 w-3.5" />
                    {item.shareAccess ? "Property access shared with worker" : "Property access not shared"}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <EButton size="sm" variant="outline" onClick={() => setReassigning(true)}>
                      Reassign
                    </EButton>
                    {isAdHoc ? (
                      <EButton size="sm" variant="outline" disabled={promoting} onClick={() => void promote(worker)}>
                        {promoting ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Create portal login
                      </EButton>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <EField label="Worker">
                    <ESelect value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
                      <option value="">Select a worker</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                          {w.trade ? ` · ${w.trade}` : ""}
                        </option>
                      ))}
                    </ESelect>
                    {!showNewWorker ? (
                      <EButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="mt-1.5 h-7 px-2"
                        onClick={() => setShowNewWorker(true)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add new worker
                      </EButton>
                    ) : null}
                  </EField>

                  {showNewWorker ? (
                    <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                      <EField label="Name *">
                        <EInput value={nwName} onChange={(e) => setNwName(e.target.value)} placeholder="Worker name" />
                      </EField>
                      <div className="grid grid-cols-2 gap-2">
                        <EField label="Phone">
                          <EInput value={nwPhone} onChange={(e) => setNwPhone(e.target.value)} />
                        </EField>
                        <EField label="Email">
                          <EInput value={nwEmail} onChange={(e) => setNwEmail(e.target.value)} />
                        </EField>
                        <EField label="Trade">
                          <EInput value={nwTrade} onChange={(e) => setNwTrade(e.target.value)} placeholder="e.g. Plumber" />
                        </EField>
                        <EField label="Company">
                          <EInput value={nwCompany} onChange={(e) => setNwCompany(e.target.value)} />
                        </EField>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <EButton size="sm" disabled={creatingWorker} onClick={() => void createWorker()}>
                          {creatingWorker ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          Save worker
                        </EButton>
                        <EButton size="sm" variant="ghost" onClick={() => setShowNewWorker(false)}>
                          Cancel
                        </EButton>
                      </div>
                    </div>
                  ) : null}

                  <EField label="Schedule">
                    <EInput
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                    />
                  </EField>

                  <div className="flex items-center justify-between gap-3">
                    <ESwitch
                      checked={shareAccess}
                      onCheckedChange={setShareAccess}
                      label="Share property access with worker"
                    />
                  </div>

                  <EField label="Contact person">
                    <ESelect
                      value={contactPersonUserId}
                      onChange={(e) => setContactPersonUserId(e.target.value)}
                    >
                      <option value={NONE}>No contact person</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name ?? u.email ?? "Unnamed"}
                          {u.email ? ` · ${u.email}` : ""}
                        </option>
                      ))}
                    </ESelect>
                  </EField>

                  <div className="flex gap-2">
                    <EButton disabled={assigning} onClick={() => void assign()}>
                      {assigning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                      {reassigning ? "Reassign" : "Assign"}
                    </EButton>
                    {reassigning ? (
                      <EButton variant="ghost" onClick={() => setReassigning(false)}>
                        Cancel
                      </EButton>
                    ) : null}
                  </div>
                </div>
              )}
            </ECardBody>
          </ECard>

          {/* Property client */}
          {item.property.client ? (
            <ECard>
              <ECardHeader>
                <ECardTitle className="text-[1rem]">Property client</ECardTitle>
              </ECardHeader>
              <ECardBody className="space-y-1.5 text-[0.875rem]">
                <p className="font-medium text-[hsl(var(--e-foreground))]">{item.property.client.name ?? "—"}</p>
                {item.property.client.phone ? (
                  <a
                    href={`tel:${item.property.client.phone}`}
                    className="inline-flex items-center gap-1.5 text-[hsl(var(--e-gold-ink))] hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" /> {item.property.client.phone}
                  </a>
                ) : null}
                {item.property.client.email ? (
                  <a
                    href={`mailto:${item.property.client.email}`}
                    className="inline-flex items-center gap-1.5 text-[hsl(var(--e-gold-ink))] hover:underline"
                  >
                    <Mail className="h-3.5 w-3.5" /> {item.property.client.email}
                  </a>
                ) : null}
              </ECardBody>
            </ECard>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">{label}</p>
      <p className="e-tnum text-[0.875rem] text-[hsl(var(--e-foreground))]">{value || "—"}</p>
    </div>
  );
}

function NoteBlock({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">{label}</p>
      <p className="text-[0.875rem] text-[hsl(var(--e-foreground))]">{body}</p>
    </div>
  );
}

function PingRow({ label, lat, lng, at }: { label: string; lat: number; lng: number; at?: string | null }) {
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[hsl(var(--e-muted-foreground))]">
        {label}
        {at ? ` · ${fmtDate(at)}` : ""}
      </span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[hsl(var(--e-gold-ink))] hover:underline"
      >
        <MapPin className="h-3.5 w-3.5" /> View pin
        <ExternalLink className="h-3 w-3 opacity-60" />
      </a>
    </div>
  );
}
