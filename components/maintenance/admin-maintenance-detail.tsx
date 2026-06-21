"use client";

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
} from "lucide-react";
import {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  MaintenanceStatus,
} from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaGallery } from "@/components/shared/media-gallery";
import { ClockLocationsMap } from "@/components/shared/clock-locations-map";
import { googleMapsDirectionsUrl } from "@/lib/maps/google-maps-url";
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

/** ISO datetime → value for <input type="datetime-local"> (local time, no tz). */
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

// ─── Component ─────────────────────────────────────────────────────────────────

export function AdminMaintenanceDetail({ itemId }: { itemId: string }) {
  const [item, setItem] = React.useState<MaintenanceDetailItem | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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
      // Seed the assignment form from current values.
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

  async function createWorker() {
    if (!nwName.trim()) {
      toast({ title: "Name required", description: "Enter a name for the worker.", variant: "destructive" });
      return;
    }
    setCreatingWorker(true);
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
        toast({ title: "Could not add worker", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "Worker added", description: nwName.trim() });
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
      toast({ title: "Pick a worker", description: "Select a worker to assign.", variant: "destructive" });
      return;
    }
    setAssigning(true);
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
        toast({ title: "Could not assign", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "Worker assigned", description: "The maintenance visit has been scheduled." });
      setReassigning(false);
      await loadItem();
    } finally {
      setAssigning(false);
    }
  }

  async function promote(worker: Worker) {
    setPromoting(true);
    try {
      const res = await fetch(`/api/admin/maintenance/workers/${worker.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        toast({ title: "Could not create login", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({
        title: "Portal login created",
        description: body.invitationEmailSent
          ? "An invitation email was sent to the worker."
          : body.invitationLink
            ? `Invitation link: ${body.invitationLink}`
            : "Login created. Share their invitation manually.",
      });
      await loadWorkers();
      await loadItem();
    } finally {
      setPromoting(false);
    }
  }

  // ─── Render states ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading maintenance item…
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/maintenance"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to maintenance
        </Link>
        <Card className="rounded-xl border-destructive/30">
          <CardContent className="flex items-center gap-2 p-6 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error ?? "Item not found."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const worker = item.assignedWorker;
  const isAdHoc = worker ? worker.isPermanent === false || worker.userId == null : false;
  const directionsUrl = googleMapsDirectionsUrl(item.property);
  const firstPing = item.pings.length > 0 ? item.pings[0] : null;
  const lastPing = item.pings.length > 1 ? item.pings[item.pings.length - 1] : null;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/maintenance"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to maintenance
      </Link>

      <PageHeader
        title={item.title}
        description={
          <span>
            {item.property.name}
            {fullAddress(item.property) ? ` · ${fullAddress(item.property)}` : ""}
          </span>
        }
        icon={<Wrench />}
      />

      {/* Status / meta badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={priorityTone(item.priority)}>{PRIORITY_LABELS[item.priority]}</Badge>
        <Badge variant={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Badge>
        <Badge variant="secondary">{CATEGORY_LABELS[item.category]}</Badge>
        <Badge variant="outline">{ACTION_LABELS[item.recommendedAction]}</Badge>
        {!item.clientVisible ? <Badge variant="outline">Internal</Badge> : null}
        {item.area ? <Badge variant="outline">{item.area}</Badge> : null}
      </div>

      {/* Reported-by + cost */}
      <p className="text-sm text-muted-foreground">
        Reported by {item.reportedBy?.name ?? item.reportedBy?.email ?? "—"}
        {item.source ? ` (${SOURCE_LABELS[item.source]})` : ""}
        {item.createdAt ? ` · ${fmtDate(item.createdAt)}` : ""}
        {item.estimatedCost != null ? ` · Est. $${item.estimatedCost.toFixed(2)}` : ""}
      </p>

      {item.description ? (
        <Card className="rounded-xl">
          <CardContent className="p-5 text-sm text-foreground">{item.description}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left column: photos + visit progress + history ── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Reported photos */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4" /> Reported photos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MediaGallery
                items={item.photos.map((p) => ({ id: p.key, url: p.url }))}
                title="Reported photos"
                emptyText="No photos were attached when this was reported."
              />
            </CardContent>
          </Card>

          {/* Finish photos */}
          {item.finishPhotos.length > 0 ? (
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-4 w-4" /> Work completed photos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MediaGallery
                  items={item.finishPhotos.map((p) => ({ id: p.key, url: p.url }))}
                  title="Work completed photos"
                />
              </CardContent>
            </Card>
          ) : null}

          {/* Visit progress */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Route className="h-4 w-4" /> Visit progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <Stat label="Scheduled" value={fmtDate(item.scheduledFor)} />
                <Stat label="En route" value={fmtDate(item.enRouteAt)} />
                <Stat label="Arrived" value={fmtDate(item.arrivedAt)} />
                <Stat label="Clock in" value={fmtDate(item.clockInAt)} />
                <Stat label="Clock out" value={fmtDate(item.clockOutAt)} />
                <Stat label="Resolved" value={fmtDate(item.resolvedAt)} />
              </div>
              {item.outcome ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Outcome</p>
                  <p className="text-sm text-foreground">{item.outcome}</p>
                </div>
              ) : null}
              {item.workerNote ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Worker note</p>
                  <p className="text-sm text-foreground">{item.workerNote}</p>
                </div>
              ) : null}
              {item.issuesNote ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Issues raised</p>
                  <p className="text-sm text-foreground">{item.issuesNote}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Location */}
          {item.pings.length > 0 ? (
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4" /> Worker location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ClockLocationsMap
                  property={{
                    lat: item.property.latitude,
                    lng: item.property.longitude,
                    name: item.property.name,
                  }}
                  checkIn={
                    firstPing ? { lat: firstPing.lat, lng: firstPing.lng, at: firstPing.createdAt } : null
                  }
                  checkOut={
                    lastPing ? { lat: lastPing.lat, lng: lastPing.lng, at: lastPing.createdAt } : null
                  }
                />
                {directionsUrl ? (
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <MapPin className="h-3.5 w-3.5" /> Open in Maps
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </a>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Event history */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" /> Event history
              </CardTitle>
            </CardHeader>
            <CardContent>
              {item.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events recorded yet.</p>
              ) : (
                <ol className="space-y-3 border-l-2 border-border pl-4">
                  {item.events.map((ev) => (
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
                        {fmtDate(ev.createdAt)}
                        {ev.user?.name ? ` · ${ev.user.name}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right column: assignment ── */}
        <div className="space-y-6">
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4" /> Assignment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current worker (if assigned and not reassigning) */}
              {worker && !reassigning ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-surface-raised/40 p-3">
                    <p className="font-semibold text-foreground">{worker.name}</p>
                    {(worker.trade || worker.company) ? (
                      <p className="text-xs text-muted-foreground">
                        {[worker.trade, worker.company].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-col gap-1.5 text-sm">
                      {worker.phone ? (
                        <a
                          href={`tel:${worker.phone}`}
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <Phone className="h-3.5 w-3.5" /> {worker.phone}
                        </a>
                      ) : null}
                      {worker.email ? (
                        <a
                          href={`mailto:${worker.email}`}
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <Mail className="h-3.5 w-3.5" /> {worker.email}
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {item.scheduledFor ? (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" /> Scheduled for {fmtDate(item.scheduledFor)}
                    </p>
                  ) : null}
                  {item.contactPerson ? (
                    <p className="text-sm text-muted-foreground">
                      Contact: {item.contactPerson.name ?? item.contactPerson.email ?? "—"}
                    </p>
                  ) : null}
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <KeyRound className="h-3.5 w-3.5" />
                    {item.shareAccess ? "Property access shared with worker" : "Property access not shared"}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setReassigning(true)}>
                      Reassign
                    </Button>
                    {isAdHoc ? (
                      <Button size="sm" variant="outline" disabled={promoting} onClick={() => promote(worker)}>
                        {promoting ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Create portal login
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                // Assignment / reassignment form
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Worker</Label>
                    <Select value={workerId} onValueChange={setWorkerId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a worker" />
                      </SelectTrigger>
                      <SelectContent>
                        {workers.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                            {w.trade ? ` · ${w.trade}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!showNewWorker ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setShowNewWorker(true)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add new worker
                      </Button>
                    ) : null}
                  </div>

                  {/* New worker mini-form */}
                  {showNewWorker ? (
                    <div className="space-y-2 rounded-lg border border-border bg-surface-raised/40 p-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Name *</Label>
                        <Input value={nwName} onChange={(e) => setNwName(e.target.value)} placeholder="Worker name" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Phone</Label>
                          <Input value={nwPhone} onChange={(e) => setNwPhone(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Email</Label>
                          <Input value={nwEmail} onChange={(e) => setNwEmail(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Trade</Label>
                          <Input value={nwTrade} onChange={(e) => setNwTrade(e.target.value)} placeholder="e.g. Plumber" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Company</Label>
                          <Input value={nwCompany} onChange={(e) => setNwCompany(e.target.value)} />
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" disabled={creatingWorker} onClick={createWorker}>
                          {creatingWorker ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          Save worker
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowNewWorker(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label>Schedule</Label>
                    <Input
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="share-access" className="text-sm">
                      Share property access with worker
                    </Label>
                    <Switch
                      id="share-access"
                      checked={shareAccess}
                      onCheckedChange={setShareAccess}
                      aria-label="Share property access with worker"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Contact person</Label>
                    <Select value={contactPersonUserId} onValueChange={setContactPersonUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a contact" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No contact person</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name ?? u.email ?? "Unnamed"}
                            {u.email ? ` · ${u.email}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-2">
                    <Button disabled={assigning} onClick={assign}>
                      {assigning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                      {reassigning ? "Reassign" : "Assign"}
                    </Button>
                    {reassigning ? (
                      <Button variant="ghost" onClick={() => setReassigning(false)}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Property contact */}
          {item.property.client ? (
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">Property client</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <p className="font-medium text-foreground">{item.property.client.name ?? "—"}</p>
                {item.property.client.phone ? (
                  <a
                    href={`tel:${item.property.client.phone}`}
                    className="inline-flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" /> {item.property.client.phone}
                  </a>
                ) : null}
                {item.property.client.email ? (
                  <a
                    href={`mailto:${item.property.client.email}`}
                    className="inline-flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <Mail className="h-3.5 w-3.5" /> {item.property.client.email}
                  </a>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm tabular-nums text-foreground">{value || "—"}</p>
    </div>
  );
}
