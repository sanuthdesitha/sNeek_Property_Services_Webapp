"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  MapPin,
  Navigation,
  Phone,
  Mail,
  MessageSquare,
  KeyRound,
  ShieldAlert,
  Car,
  Flag,
  Clock,
  Camera,
  CheckCircle2,
  Loader2,
  Radio,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { UploadDropzone, type UploadResult } from "@/components/ui/upload-dropzone";
import { MediaGallery } from "@/components/shared/media-gallery";
import { AccessInstructionsPanel } from "@/components/shared/access-instructions-panel";
import { googleMapsDirectionsUrl } from "@/lib/maps/google-maps-url";
import { toast } from "@/hooks/use-toast";

// ── Types (mirror the GET /api/maintenance/[id] contract) ──────────────────

type Photo = { key: string; url: string };

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
  placeId: string | null;
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

function prettyEnum(v: string | null): string {
  if (!v) return "";
  return v
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Strip any HTML tags + decode common entities so stored rich-text access
 *  details render as plain, readable text (not raw markup). */
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

/** "wifiPassword" / "lock_box" → "Wifi password" / "Lock box". */
function prettyKey(k: string): string {
  const spaced = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : k;
}

function priorityVariant(p: string | null): "default" | "secondary" | "destructive" | "warning" | "success" | "outline" {
  switch (p) {
    case "URGENT":
      return "destructive";
    case "HIGH":
      return "warning";
    case "LOW":
      return "outline";
    default:
      return "secondary";
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
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

export function WorkerVisitClient({ itemId }: { itemId: string }) {
  const [item, setItem] = React.useState<VisitItem | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<VisitEvent | null>(null);

  // Finish media keys gathered before completing.
  const [finishKeys, setFinishKeys] = React.useState<string[]>([]);
  const [finishMedia, setFinishMedia] = React.useState<UploadResult[]>([]);

  // Outcome form.
  const [showComplete, setShowComplete] = React.useState(false);
  const [outcome, setOutcome] = React.useState<string>("FIXED");
  const [workerNote, setWorkerNote] = React.useState("");
  const [issuesNote, setIssuesNote] = React.useState("");

  // Background location tracking state.
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

  // ── Background location tracking while the visit is active ────────────────
  const isResolved = Boolean(item?.resolvedAt || item?.clockOutAt || item?.outcome);
  const isActiveVisit = Boolean(item?.enRouteAt) && !isResolved;

  const stopTracking = React.useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
  }, []);

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
        // Throttle: at most one ping per ~45s.
        if (now - lastPingAtRef.current < PING_INTERVAL_MS) return;
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

  // Clean up the watch on unmount.
  React.useEffect(() => () => stopTracking(), [stopTracking]);

  // ── Visit lifecycle actions ──────────────────────────────────────────────
  async function postEvent(event: VisitEvent, extra: Record<string, unknown> = {}) {
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
      // The visit endpoint returns a bare item (no photos/property/contact
      // relations) — always refetch the full record so the view stays complete.
      await load();
      return true;
    } catch (err) {
      toast({
        title: "Something went wrong",
        description: err instanceof Error ? err.message : "Could not update the visit.",
        variant: "destructive",
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleStartDriving() {
    if (await postEvent("EN_ROUTE")) {
      toast({ title: "On the way", description: "Location sharing is now active." });
    }
  }
  async function handleArrived() {
    if (await postEvent("ARRIVED")) toast({ title: "Arrived", description: "Marked as arrived." });
  }
  async function handleClockIn() {
    if (await postEvent("CLOCK_IN")) toast({ title: "Clocked in", description: "Work started." });
  }
  async function handleComplete() {
    const ok = await postEvent("COMPLETE", {
      outcome,
      workerNote: workerNote.trim() || undefined,
      issuesNote: issuesNote.trim() || undefined,
      finishPhotoKeys: finishKeys,
    });
    if (ok) {
      stopTracking();
      setShowComplete(false);
      toast({ title: "Job complete", description: "Nice work — the job is resolved." });
    }
  }

  function addFinishKey(result: UploadResult) {
    setFinishKeys((prev) => (prev.includes(result.key) ? prev : [...prev, result.key]));
    setFinishMedia((prev) => [...prev, result]);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading job…
          </CardContent>
        </Card>
      </div>
    );
  }

  const prop = item.property;
  const fullAddress = prop
    ? [prop.address, prop.suburb, [prop.state, prop.postcode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";
  const navUrl = prop ? googleMapsDirectionsUrl(prop) : "";
  const hasCoords =
    typeof prop?.latitude === "number" && typeof prop?.longitude === "number";
  const mapEmbed = hasCoords
    ? `https://www.google.com/maps?q=${prop!.latitude},${prop!.longitude}&z=15&output=embed`
    : null;

  const accessShared =
    item.shareAccess &&
    Boolean(prop?.accessCode || prop?.alarmCode || prop?.keyLocation || prop?.accessNotes || prop?.accessInfo);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <BackLink />

      <PageHeader
        title={item.title}
        description={prop?.name ? `${prop.name}${fullAddress ? ` · ${fullAddress}` : ""}` : fullAddress || undefined}
        icon={<MapPin />}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {item.priority ? <Badge variant={priorityVariant(item.priority)}>{prettyEnum(item.priority)}</Badge> : null}
            {item.status ? (
              <Badge variant={isResolved ? "success" : "secondary"}>{prettyEnum(item.status)}</Badge>
            ) : null}
          </div>
        }
      />

      {/* Location sharing indicator */}
      {isActiveVisit ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs font-medium text-foreground">
          <Radio className={tracking ? "h-4 w-4 animate-pulse text-success" : "h-4 w-4 text-muted-foreground"} />
          {tracking ? "Location sharing: active" : "Starting location sharing…"}
        </div>
      ) : null}

      {/* Success state */}
      {isResolved ? (
        <Card className="border-success/40 bg-success/10">
          <CardContent className="flex items-center gap-3 py-5">
            <CheckCircle2 className="h-7 w-7 shrink-0 text-success" />
            <div>
              <p className="text-sm font-semibold text-foreground">Job complete</p>
              <p className="text-xs text-muted-foreground">
                {item.outcome ? `Outcome: ${prettyEnum(item.outcome)}` : "This job has been resolved."}
                {item.resolvedAt ? ` · ${fmtTime(item.resolvedAt)}` : ""}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Access panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Access details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accessShared ? (
            <div className="space-y-3">
              <dl className="space-y-2 text-sm">
                {cleanText(prop?.accessCode) ? <AccessRow label="Access code" value={cleanText(prop?.accessCode)} /> : null}
                {cleanText(prop?.alarmCode) ? <AccessRow label="Alarm code" value={cleanText(prop?.alarmCode)} /> : null}
                {cleanText(prop?.keyLocation) ? <AccessRow label="Key location" value={cleanText(prop?.keyLocation)} /> : null}
                {cleanText(prop?.accessNotes) ? <AccessRow label="Access notes" value={cleanText(prop?.accessNotes)} /> : null}
              </dl>
              {/* Full onboarding access instructions, including reference images/videos. */}
              <AccessInstructionsPanel
                accessInfo={prop?.accessInfo}
                title="Property access instructions"
                className="text-xs"
              />
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Access details not shared — contact the person in charge.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contacts */}
      {item.contactPerson || prop?.client ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contacts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {item.contactPerson ? (
              <ContactBlock label="Person in charge" contact={item.contactPerson} />
            ) : null}
            {prop?.client ? <ContactBlock label="Property client" contact={prop.client} /> : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Navigate */}
      {prop ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Navigation className="h-4 w-4" /> Navigate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {fullAddress ? <p className="text-sm text-muted-foreground">{fullAddress}</p> : null}
            {navUrl ? (
              <Button asChild className="h-14 w-full text-base">
                <a href={navUrl} target="_blank" rel="noreferrer">
                  <Navigation className="mr-2 h-5 w-5" /> Navigate
                </a>
              </Button>
            ) : null}
            {mapEmbed ? (
              <iframe
                title="Property location"
                src={mapEmbed}
                className="h-48 w-full rounded-lg border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Before photos / what to fix */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" /> What to fix
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {item.area ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Area: </span>
              <span className="font-medium">{item.area}</span>
            </p>
          ) : null}
          {item.description ? <p className="text-sm text-foreground">{item.description}</p> : null}
          <MediaGallery
            items={item.photos.map((p) => ({ id: p.key, url: p.url }))}
            title="What to fix"
            emptyText="No photos provided."
          />
        </CardContent>
      </Card>

      {/* Visit lifecycle stepper */}
      {!isResolved ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" /> Visit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Do these in any order — &ldquo;Start driving&rdquo; and &ldquo;Arrived&rdquo; are optional. You can clock in or complete the job straight away.
            </p>

            {/* Step 1 — Start driving (optional) */}
            <LifecycleStep
              done={Boolean(item.enRouteAt)}
              timestamp={item.enRouteAt}
              title="On the way (optional)"
            >
              {!item.enRouteAt ? (
                <Button variant="outline" className="h-14 w-full text-base" disabled={busy != null} onClick={handleStartDriving}>
                  {busy === "EN_ROUTE" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Car className="mr-2 h-5 w-5" />}
                  Start driving
                </Button>
              ) : null}
            </LifecycleStep>

            {/* Step 2 — Arrived (optional) */}
            <LifecycleStep done={Boolean(item.arrivedAt)} timestamp={item.arrivedAt} title="Arrived (optional)">
              {!item.arrivedAt ? (
                <Button variant="outline" className="h-14 w-full text-base" disabled={busy != null} onClick={handleArrived}>
                  {busy === "ARRIVED" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Flag className="mr-2 h-5 w-5" />}
                  I&apos;ve arrived
                </Button>
              ) : null}
            </LifecycleStep>

            {/* Step 3 — Clock in / start work */}
            <LifecycleStep done={Boolean(item.clockInAt)} timestamp={item.clockInAt} title="On site">
              {!item.clockInAt ? (
                <Button className="h-14 w-full text-base" disabled={busy != null} onClick={handleClockIn}>
                  {busy === "CLOCK_IN" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Clock className="mr-2 h-5 w-5" />}
                  Clock in / Start work
                </Button>
              ) : null}
            </LifecycleStep>

            {/* Step 4 — Finish photos + Complete (always available) */}
            <LifecycleStep done={false} timestamp={null} title="Finish & complete" hideConnector>
              {true ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5 text-sm">
                      <Camera className="h-4 w-4" /> Finish photos / video
                    </Label>
                    <UploadDropzone
                      accept="image/*,video/*"
                      onUploaded={addFinishKey}
                      stamp={{
                        capturerName: (item.assignedWorker?.name as string) || "Maintenance",
                        tag: "maintenance",
                        address: fullAddress || prop?.name || "",
                      }}
                    />
                    {finishMedia.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {finishMedia.map((m) => (
                          <div key={m.key} className="overflow-hidden rounded-md border bg-muted/30">
                            {/\.(mp4|mov|webm|m4v)$/i.test(m.url) || /video/i.test(m.mime) ? (
                              <video src={m.url} className="h-20 w-full object-cover" muted playsInline />
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.url} alt="" className="h-20 w-full object-cover" />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {!showComplete ? (
                    <Button className="h-14 w-full text-base" onClick={() => setShowComplete(true)}>
                      <CheckCircle2 className="mr-2 h-5 w-5" /> Complete job
                    </Button>
                  ) : (
                    <div className="space-y-4 rounded-lg border bg-background p-3">
                      <div className="space-y-2">
                        <Label htmlFor="outcome">Outcome</Label>
                        <Select value={outcome} onValueChange={setOutcome}>
                          <SelectTrigger id="outcome" className="h-12">
                            <SelectValue placeholder="Choose an outcome" />
                          </SelectTrigger>
                          <SelectContent>
                            {OUTCOMES.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="workerNote">What you did</Label>
                        <Textarea
                          id="workerNote"
                          placeholder="Describe the work done (optional)"
                          value={workerNote}
                          onChange={(e) => setWorkerNote(e.target.value)}
                          rows={3}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="issuesNote">Any issues / what&apos;s needed</Label>
                        <Textarea
                          id="issuesNote"
                          placeholder="Parts needed, follow-up, blockers (optional)"
                          value={issuesNote}
                          onChange={(e) => setIssuesNote(e.target.value)}
                          rows={3}
                        />
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button variant="outline" className="h-12 flex-1" onClick={() => setShowComplete(false)}>
                          Cancel
                        </Button>
                        <Button className="h-12 flex-1" disabled={busy != null} onClick={handleComplete}>
                          {busy === "COMPLETE" ? (
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-2 h-5 w-5" />
                          )}
                          Submit & complete
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Clock in to add finish photos and complete the job.</p>
              )}
            </LifecycleStep>
          </CardContent>
        </Card>
      ) : null}

      {/* Finish photos shown after completion */}
      {isResolved && item.finishPhotos.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Finish photos</CardTitle>
          </CardHeader>
          <CardContent>
            <MediaGallery
              items={item.finishPhotos.map((p) => ({ id: p.key, url: p.url }))}
              title="Finish photos"
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      href="/maintenance"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> My Jobs
    </Link>
  );
}

function AccessRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md border bg-muted/30 p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function ContactBlock({ label, contact }: { label: string; contact: Contact }) {
  const tel = contact.phone ? contact.phone.replace(/\s+/g, "") : null;
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{contact.name || "Contact"}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ContactAction href={tel ? `tel:${tel}` : null} Icon={Phone} label="Call" />
        <ContactAction href={contact.email ? `mailto:${contact.email}` : null} Icon={Mail} label="Email" />
        <ContactAction href={tel ? `sms:${tel}` : null} Icon={MessageSquare} label="SMS" />
      </div>
    </div>
  );
}

function ContactAction({
  href,
  Icon,
  label,
}: {
  href: string | null;
  Icon: typeof Phone;
  label: string;
}) {
  if (!href) {
    return (
      <Button variant="outline" className="h-14 flex-col gap-1" disabled>
        <Icon className="h-5 w-5" />
        <span className="text-xs">{label}</span>
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" className="h-14 flex-col gap-1">
      <a href={href}>
        <Icon className="h-5 w-5" />
        <span className="text-xs">{label}</span>
      </a>
    </Button>
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
              ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-success bg-success text-success-foreground"
              : "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-muted-foreground"
          }
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-current" />}
        </span>
        {!hideConnector ? <span className="my-1 w-0.5 flex-1 rounded-full bg-border" aria-hidden /> : null}
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className={done ? "text-sm font-semibold text-foreground" : "text-sm font-medium text-foreground"}>{title}</p>
          {done && timestamp ? <span className="text-xs text-muted-foreground">{fmtTime(timestamp)}</span> : null}
        </div>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}

export default WorkerVisitClient;
