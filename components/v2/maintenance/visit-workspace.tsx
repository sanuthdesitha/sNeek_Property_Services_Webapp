"use client";

/**
 * Native Estate maintenance on-site visit workspace — a full re-implementation of
 * the v1 worker flow (`components/maintenance/worker-visit-client.tsx`) using only
 * Estate v2 primitives, tokens, and the shared v2 MediaCapture. Zero dependency on
 * the v1 component tree.
 *
 * It hits the SAME endpoints the v1 page used — request/response shapes matched
 * exactly against the zod schemas:
 *
 *   GET  /api/maintenance/[id]          → { item }  (full record + photos/finishPhotos)
 *   POST /api/maintenance/[id]/ping     → { lat, lng, accuracy? }            → { ok }
 *   POST /api/maintenance/[id]/visit    → { event, lat?, lng?, accuracy?,
 *                                           outcome?, workerNote?, issuesNote?,
 *                                           finishPhotoKeys? }                → { ok, item }
 *
 * Photos are captured with the shared v2 MediaCapture (posts multipart to
 * `POST /api/uploads/direct`, returns `{ key, url }`); we submit the returned S3
 * keys as `finishPhotoKeys`.
 */
import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Car,
  CheckCircle2,
  Clock,
  Flag,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Radio,
  ShieldAlert,
} from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EThread,
} from "@/components/v2/ui/primitives";
import { EField, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";

/* ── Types (mirror the GET /api/maintenance/[id] contract) ─────────────────── */

type Photo = { key: string; url: string };
type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

interface Contact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface PropertyInfo {
  name: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  accessCode: string | null;
  alarmCode: string | null;
  keyLocation: string | null;
  accessNotes: string | null;
  accessInfo: unknown;
  client: Contact | null;
}

interface VisitItem {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  area: string | null;
  priority: string | null;
  status: string | null;
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
  contactPerson: Contact | null;
  assignedWorker: ({ id: string; name: string | null } & Record<string, unknown>) | null;
  property: PropertyInfo | null;
}

type VisitEvent = "EN_ROUTE" | "ARRIVED" | "CLOCK_IN" | "COMPLETE";

const OUTCOMES = [
  { value: "FIXED", label: "Fixed" },
  { value: "REPLACED", label: "Replaced" },
  { value: "NEEDS_PARTS", label: "Needs parts" },
  { value: "NEEDS_FOLLOWUP", label: "Needs follow-up" },
  { value: "NO_ACCESS", label: "No access" },
  { value: "NO_ISSUE_FOUND", label: "No issue found" },
  { value: "OTHER", label: "Other" },
];

const PING_INTERVAL_MS = 45_000;

/* ── Small pure helpers ────────────────────────────────────────────────────── */

function prettyEnum(v: string | null): string {
  if (!v) return "";
  return v
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Strip HTML tags + decode common entities so stored rich-text renders plain. */
function cleanText(v: unknown): string {
  if (v == null) return "";
  let s = typeof v === "string" ? v : String(v);
  s = s.replace(/<[^>]*>/g, " ");
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function priorityTone(p: string | null): Tone {
  switch (p) {
    case "URGENT":
      return "danger";
    case "HIGH":
      return "warning";
    case "MEDIUM":
      return "info";
    case "LOW":
      return "neutral";
    default:
      return "neutral";
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
}

function directionsUrl(prop: PropertyInfo): string {
  if (typeof prop.latitude === "number" && typeof prop.longitude === "number") {
    return `https://www.google.com/maps/dir/?api=1&destination=${prop.latitude},${prop.longitude}`;
  }
  const address = [prop.address, prop.suburb, prop.state, prop.postcode].filter(Boolean).join(", ");
  return address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : "";
}

function getPositionOnce(): Promise<{ lat?: number; lng?: number; accuracy?: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve({});
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
        }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

/* ── Props: server passes the initial shell; the client re-fetches the full
 *    record (same as v1) to stay complete after every action. ──────────────── */

export interface VisitWorkspaceProps {
  itemId: string;
  /** Server-rendered header shell so the page paints instantly before fetch. */
  initialTitle: string;
  initialPropertyName?: string | null;
  initialSuburb?: string | null;
  initialAddress?: string | null;
}

export function VisitWorkspace({
  itemId,
  initialTitle,
  initialPropertyName,
  initialSuburb,
  initialAddress,
}: VisitWorkspaceProps) {
  const [item, setItem] = React.useState<VisitItem | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<VisitEvent | null>(null);

  // Finish media captured before completing.
  const [finishMedia, setFinishMedia] = React.useState<CapturedMedia[]>([]);

  // Outcome form.
  const [showComplete, setShowComplete] = React.useState(false);
  const [outcome, setOutcome] = React.useState<string>("FIXED");
  const [workerNote, setWorkerNote] = React.useState("");
  const [issuesNote, setIssuesNote] = React.useState("");

  // Background location tracking.
  const [tracking, setTracking] = React.useState(false);
  const watchIdRef = React.useRef<number | null>(null);
  const lastPingAtRef = React.useRef<number>(0);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/maintenance/${itemId}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not load this job.");
      }
      const data: { item: VisitItem } = await res.json();
      setItem(data.item);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this job.");
    }
  }, [itemId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const isResolved = Boolean(item?.resolvedAt || item?.clockOutAt || item?.outcome);
  const isActiveVisit = Boolean(item?.enRouteAt) && !isResolved;

  const stopTracking = React.useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    setTracking(false);
  }, []);

  // ── Background GPS breadcrumbs while the visit is active ───────────────────
  React.useEffect(() => {
    if (!isActiveVisit) {
      stopTracking();
      return;
    }
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    if (watchIdRef.current != null) return; // already watching

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setTracking(true);
        const now = Date.now();
        if (now - lastPingAtRef.current < PING_INTERVAL_MS) return; // throttle ~45s
        lastPingAtRef.current = now;
        void fetch(`/api/maintenance/${itemId}/ping`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-progress-toast": "off" },
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
          }),
        }).catch(() => {
          // Best-effort; pings are advisory.
        });
      },
      () => {
        // Permission/timeout errors are non-fatal for tracking.
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );
    setTracking(true);

    return () => stopTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActiveVisit, itemId]);

  React.useEffect(() => () => stopTracking(), [stopTracking]);

  // ── Visit lifecycle actions ───────────────────────────────────────────────
  async function postEvent(event: VisitEvent, extra: Record<string, unknown> = {}): Promise<boolean> {
    setBusy(event);
    try {
      const gps = await getPositionOnce();
      const res = await fetch(`/api/maintenance/${itemId}/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, ...gps, ...extra }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not update the visit.");
      }
      // The visit endpoint returns a bare item (no relations) — always refetch
      // the full record so the view stays complete.
      await load();
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the visit.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleStartDriving() {
    await postEvent("EN_ROUTE");
  }
  async function handleArrived() {
    await postEvent("ARRIVED");
  }
  async function handleClockIn() {
    await postEvent("CLOCK_IN");
  }
  async function handleComplete() {
    const ok = await postEvent("COMPLETE", {
      outcome,
      workerNote: workerNote.trim() || undefined,
      issuesNote: issuesNote.trim() || undefined,
      finishPhotoKeys: finishMedia.map((m) => m.key),
    });
    if (ok) {
      stopTracking();
      setShowComplete(false);
    }
  }

  // ── Header shell (server-provided) for first paint + error/loading states ──
  const headerName = item?.property?.name ?? initialPropertyName ?? null;
  const headerSuburb = item?.property?.suburb ?? initialSuburb ?? "";
  const headerTitle = item?.title ?? initialTitle;

  if (error && !item) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EAlert tone="danger" title="Couldn't load this job">
          {error}
        </EAlert>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ECard>
          <ECardBody className="flex items-center justify-center gap-2 py-12 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading job…
          </ECardBody>
        </ECard>
      </div>
    );
  }

  const prop = item.property;
  const fullAddress = prop
    ? [prop.address, prop.suburb, [prop.state, prop.postcode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";
  const navUrl = prop ? directionsUrl(prop) : "";
  const hasCoords = typeof prop?.latitude === "number" && typeof prop?.longitude === "number";
  const mapEmbed = hasCoords
    ? `https://www.google.com/maps?q=${prop!.latitude},${prop!.longitude}&z=15&output=embed`
    : null;

  const accessShared =
    item.shareAccess &&
    Boolean(prop?.accessCode || prop?.alarmCode || prop?.keyLocation || prop?.accessNotes || prop?.accessInfo);

  return (
    <div className="space-y-6">
      <BackLink />

      <EPageHeader
        eyebrow="Maintenance visit"
        title={headerTitle}
        description={
          headerName
            ? `${headerName}${fullAddress ? ` · ${fullAddress}` : headerSuburb ? ` · ${headerSuburb}` : ""}`
            : fullAddress || undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {item.priority ? (
              <EBadge tone={priorityTone(item.priority)} soft>
                {prettyEnum(item.priority)}
              </EBadge>
            ) : null}
            {item.status ? (
              <EBadge tone={isResolved ? "success" : "primary"} soft>
                {prettyEnum(item.status)}
              </EBadge>
            ) : null}
          </div>
        }
      />

      {error ? (
        <EAlert tone="danger" title="Something went wrong">
          {error}
        </EAlert>
      ) : null}

      {/* Location sharing indicator */}
      {isActiveVisit ? (
        <div className="flex items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-success)/0.4)] bg-[hsl(var(--e-success)/0.1)] px-3 py-2 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">
          <Radio
            className={
              tracking
                ? "h-4 w-4 animate-pulse text-[hsl(var(--e-success))]"
                : "h-4 w-4 text-[hsl(var(--e-muted-foreground))]"
            }
          />
          {tracking ? "Location sharing: active" : "Starting location sharing…"}
        </div>
      ) : null}

      {/* Success state */}
      {isResolved ? (
        <ECard variant="ceremony">
          <ECardBody className="flex items-center gap-3 py-5 pt-5">
            <CheckCircle2 className="h-7 w-7 flex-shrink-0 text-[hsl(var(--e-success))]" />
            <div>
              <p className="text-[0.875rem] font-[600] text-[hsl(var(--e-foreground))]">Job complete</p>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {item.outcome ? `Outcome: ${prettyEnum(item.outcome)}` : "This job has been resolved."}
                {item.resolvedAt ? ` · ${fmtTime(item.resolvedAt)}` : ""}
              </p>
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Access panel */}
      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2 text-[1rem]">
            <KeyRound className="h-4 w-4" /> Access details
          </ECardTitle>
        </ECardHeader>
        <ECardBody>
          {accessShared ? (
            <dl className="space-y-2">
              {cleanText(prop?.accessCode) ? <AccessRow label="Access code" value={cleanText(prop?.accessCode)} /> : null}
              {cleanText(prop?.alarmCode) ? <AccessRow label="Alarm code" value={cleanText(prop?.alarmCode)} /> : null}
              {cleanText(prop?.keyLocation) ? <AccessRow label="Key location" value={cleanText(prop?.keyLocation)} /> : null}
              {cleanText(prop?.accessNotes) ? <AccessRow label="Access notes" value={cleanText(prop?.accessNotes)} /> : null}
            </dl>
          ) : (
            <div className="flex items-start gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>Access details not shared — contact the person in charge.</span>
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* Contacts */}
      {item.contactPerson || prop?.client ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="text-[1rem]">Contacts</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4">
            {item.contactPerson ? <ContactBlock label="Person in charge" contact={item.contactPerson} /> : null}
            {prop?.client ? <ContactBlock label="Property client" contact={prop.client} /> : null}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Navigate */}
      {prop ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2 text-[1rem]">
              <Navigation className="h-4 w-4" /> Navigate
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            {fullAddress ? (
              <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{fullAddress}</p>
            ) : null}
            {navUrl ? (
              <EButton asChild variant="gold" className="w-full">
                <a href={navUrl} target="_blank" rel="noreferrer">
                  <Navigation className="h-4 w-4" /> Navigate
                </a>
              </EButton>
            ) : null}
            {mapEmbed ? (
              <iframe
                title="Property location"
                src={mapEmbed}
                className="h-48 w-full rounded-[var(--e-radius)] border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}

      {/* What to fix / before photos */}
      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2 text-[1rem]">
            <ShieldAlert className="h-4 w-4" /> What to fix
          </ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3">
          {item.area ? (
            <p className="text-[0.875rem]">
              <span className="text-[hsl(var(--e-muted-foreground))]">Area: </span>
              <span className="font-[550]">{item.area}</span>
            </p>
          ) : null}
          {item.description ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-foreground))]">{item.description}</p>
          ) : null}
          <PhotoGrid photos={item.photos} emptyText="No photos provided." />
        </ECardBody>
      </ECard>

      {/* Visit lifecycle */}
      {!isResolved ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2 text-[1rem]">
              <Clock className="h-4 w-4" /> Visit
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4">
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Do these in any order — &ldquo;Start driving&rdquo; and &ldquo;Arrived&rdquo; are optional. You can clock in
              or complete the job straight away.
            </p>

            <LifecycleStep done={Boolean(item.enRouteAt)} timestamp={item.enRouteAt} title="On the way (optional)">
              {!item.enRouteAt ? (
                <EButton variant="outline" className="w-full" disabled={busy != null} onClick={handleStartDriving}>
                  {busy === "EN_ROUTE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Car className="h-4 w-4" />}
                  Start driving
                </EButton>
              ) : null}
            </LifecycleStep>

            <LifecycleStep done={Boolean(item.arrivedAt)} timestamp={item.arrivedAt} title="Arrived (optional)">
              {!item.arrivedAt ? (
                <EButton variant="outline" className="w-full" disabled={busy != null} onClick={handleArrived}>
                  {busy === "ARRIVED" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                  I&apos;ve arrived
                </EButton>
              ) : null}
            </LifecycleStep>

            <LifecycleStep done={Boolean(item.clockInAt)} timestamp={item.clockInAt} title="On site">
              {!item.clockInAt ? (
                <EButton variant="primary" className="w-full" disabled={busy != null} onClick={handleClockIn}>
                  {busy === "CLOCK_IN" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                  Clock in / Start work
                </EButton>
              ) : null}
            </LifecycleStep>

            <LifecycleStep done={false} timestamp={null} title="Finish & complete" hideConnector>
              <div className="space-y-4">
                <EField label="Finish photos / video">
                  <MediaCapture value={finishMedia} onChange={setFinishMedia} mode="both" folder="maintenance" multiple />
                </EField>

                {!showComplete ? (
                  <EButton variant="gold" className="w-full" onClick={() => setShowComplete(true)}>
                    <CheckCircle2 className="h-4 w-4" /> Complete job
                  </EButton>
                ) : (
                  <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-3">
                    <EField label="Outcome">
                      <ESelect value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                        {OUTCOMES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </ESelect>
                    </EField>
                    <EField label="What you did (optional)">
                      <ETextarea
                        placeholder="Describe the work done"
                        value={workerNote}
                        onChange={(e) => setWorkerNote(e.target.value)}
                        rows={3}
                      />
                    </EField>
                    <EField label="Any issues / what's needed (optional)">
                      <ETextarea
                        placeholder="Parts needed, follow-up, blockers"
                        value={issuesNote}
                        onChange={(e) => setIssuesNote(e.target.value)}
                        rows={3}
                      />
                    </EField>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <EButton
                        variant="ghost"
                        className="flex-1"
                        disabled={busy != null}
                        onClick={() => setShowComplete(false)}
                      >
                        Cancel
                      </EButton>
                      <EButton variant="gold" className="flex-1" disabled={busy != null} onClick={handleComplete}>
                        {busy === "COMPLETE" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        Submit &amp; complete
                      </EButton>
                    </div>
                  </div>
                )}
              </div>
            </LifecycleStep>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Finish photos after completion */}
      {isResolved && item.finishPhotos.length > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="text-[1rem]">Finish photos</ECardTitle>
          </ECardHeader>
          <ECardBody>
            <PhotoGrid photos={item.finishPhotos} />
          </ECardBody>
        </ECard>
      ) : null}

      {/* Resolution notes after completion */}
      {isResolved && (item.workerNote || item.issuesNote) ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="text-[1rem]">Resolution notes</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            {item.workerNote ? (
              <div>
                <p className="e-eyebrow">What was done</p>
                <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-foreground))]">{item.workerNote}</p>
              </div>
            ) : null}
            {item.issuesNote ? (
              <div>
                <p className="e-eyebrow">Issues / follow-up</p>
                <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-foreground))]">{item.issuesNote}</p>
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}

/* ── Presentational helpers ────────────────────────────────────────────────── */

function BackLink() {
  return (
    <Link
      href="/v2/maintenance"
      className="inline-flex items-center gap-1.5 text-[0.875rem] font-[550] text-[hsl(var(--e-muted-foreground))] transition-colors hover:text-[hsl(var(--e-foreground))]"
    >
      <ArrowLeft className="h-4 w-4" /> Maintenance
    </Link>
  );
}

function AccessRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-2">
      <dt className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{label}</dt>
      <dd className="break-words text-[0.875rem] font-[600] text-[hsl(var(--e-foreground))]">{value}</dd>
    </div>
  );
}

function ContactBlock({ label, contact }: { label: string; contact: Contact }) {
  const tel = contact.phone ? contact.phone.replace(/\s+/g, "") : null;
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{label}</p>
        <p className="text-[0.875rem] font-[600] text-[hsl(var(--e-foreground))]">{contact.name || "Contact"}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ContactAction href={tel ? `tel:${tel}` : null} Icon={Phone} label="Call" />
        <ContactAction href={contact.email ? `mailto:${contact.email}` : null} Icon={Mail} label="Email" />
        <ContactAction href={tel ? `sms:${tel}` : null} Icon={MessageSquare} label="SMS" />
      </div>
    </div>
  );
}

function ContactAction({ href, Icon, label }: { href: string | null; Icon: typeof Phone; label: string }) {
  if (!href) {
    return (
      <EButton variant="outline" className="h-auto flex-col gap-1 py-2" disabled>
        <Icon className="h-5 w-5" />
        <span className="text-[0.75rem]">{label}</span>
      </EButton>
    );
  }
  return (
    <EButton asChild variant="outline" className="h-auto flex-col gap-1 py-2">
      <a href={href}>
        <Icon className="h-5 w-5" />
        <span className="text-[0.75rem]">{label}</span>
      </a>
    </EButton>
  );
}

function PhotoGrid({ photos, emptyText }: { photos: Photo[]; emptyText?: string }) {
  if (!photos || photos.length === 0) {
    return emptyText ? (
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{emptyText}</p>
    ) : null;
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((p) => {
        const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(p.url);
        return (
          <a
            key={p.key}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="block aspect-square overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]"
          >
            {isVideo ? (
              <video src={p.url} className="h-full w-full object-cover" muted playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.url} alt="" className="h-full w-full object-cover" />
            )}
          </a>
        );
      })}
    </div>
  );
}

function LifecycleStep({
  done,
  timestamp,
  title,
  children,
  hideConnector,
}: {
  done: boolean;
  timestamp: string | null;
  title: string;
  children?: React.ReactNode;
  hideConnector?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={
            done
              ? "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-[hsl(var(--e-success))] bg-[hsl(var(--e-success))] text-[hsl(var(--e-background))]"
              : "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))]"
          }
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-current" />}
        </span>
        {!hideConnector ? (
          <span className="my-1 w-0.5 flex-1 rounded-full bg-[hsl(var(--e-border))]" aria-hidden />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p
            className={
              done
                ? "text-[0.875rem] font-[600] text-[hsl(var(--e-foreground))]"
                : "text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]"
            }
          >
            {title}
          </p>
          {done && timestamp ? (
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{fmtTime(timestamp)}</span>
          ) : null}
        </div>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}

export default VisitWorkspace;
