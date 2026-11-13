/**
 * Clock locations per cleaner and per segment (live location 2026-11): where
 * each cleaner was when each clock segment started and stopped, the distance
 * from the property, the fix's accuracy, the verdict and any off-site reason,
 * or that the start was a tag tap. Segments recorded before the change say
 * "not recorded" rather than inventing a position. Server-safe (no hooks).
 */
import { formatInTimeZone } from "date-fns-tz";
import { offSiteReasonLabel } from "@/lib/gps/off-site-reasons";
import { NO_FIX_LABEL, noFixErrorLabel } from "@/lib/gps/start-location";
import { EBadge } from "@/components/v2/ui/primitives";

export type SegmentLocationLog = {
  id: string;
  startedAt: Date;
  stoppedAt: Date | null;
  user: { name: string | null; email: string } | null;
  startLat: number | null;
  startLng: number | null;
  startAccuracyM: number | null;
  startDistanceM: number | null;
  startVerdict: string | null;
  startReasonCode: string | null;
  startNote: string | null;
  startLocationSource: string | null;
  startLocationAt?: Date | null;
  stopLat: number | null;
  stopLng: number | null;
  stopAccuracyM: number | null;
  stopDistanceM: number | null;
};

const VERDICT: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  ON_SITE: { label: "On site", tone: "success" },
  OFF_SITE: { label: "Started away", tone: "warning" },
  UNRELIABLE: { label: "Fix too rough to judge", tone: "neutral" },
  NO_GEOFENCE: { label: "Property has no map pin", tone: "neutral" },
};

function metres(value: number | null): string {
  if (value == null) return "";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
}

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Started without a fix: never on site, never off site; a later fix is labelled late. */
function NoFixStart({ log, timeZone }: { log: SegmentLocationLog; timeZone: string }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <EBadge tone="neutral" soft>{NO_FIX_LABEL}</EBadge>
      <span className="basis-full text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Reason: {log.startNote ?? "none given"} · device: {noFixErrorLabel(log.startReasonCode)}
      </span>
      {log.startLat != null && log.startLng != null ? (
        <span className="basis-full">
          Late location{log.startLocationAt ? ` at ${formatInTimeZone(log.startLocationAt, timeZone, "HH:mm")}` : ""}: {metres(log.startDistanceM)}{log.startDistanceM != null ? " from the pin" : ""}{log.startAccuracyM != null ? ` · ±${Math.round(log.startAccuracyM)} m` : ""}{" "}
          <a className="text-[hsl(var(--e-accent-portal))] hover:underline" href={mapsLink(log.startLat, log.startLng)} target="_blank" rel="noreferrer">Map</a>
        </span>
      ) : (
        <span className="basis-full text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No later position yet.</span>
      )}
    </span>
  );
}

function StartCell({ log, timeZone }: { log: SegmentLocationLog; timeZone: string }) {
  if (log.startLocationSource === "NFC") return <span>Tag tapped at the door</span>;
  if (log.startVerdict === "NO_FIX") return <NoFixStart log={log} timeZone={timeZone} />;
  if (log.startLat == null || log.startLng == null) return <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>;
  const verdict = log.startVerdict ? VERDICT[log.startVerdict] : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {verdict ? <EBadge tone={verdict.tone} soft>{verdict.label}</EBadge> : null}
      <span>{metres(log.startDistanceM)}{log.startDistanceM != null ? " from the pin" : ""}{log.startAccuracyM != null ? ` · ±${Math.round(log.startAccuracyM)} m` : ""}</span>
      <a className="text-[hsl(var(--e-accent-portal))] hover:underline" href={mapsLink(log.startLat, log.startLng)} target="_blank" rel="noreferrer">Map</a>
      {log.startReasonCode ? <span className="basis-full text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Reason: {offSiteReasonLabel(log.startReasonCode) ?? log.startReasonCode}{log.startNote ? ` — ${log.startNote}` : ""}</span> : null}
    </span>
  );
}

function StopCell({ log }: { log: SegmentLocationLog }) {
  if (!log.stoppedAt) return <span className="text-[hsl(var(--e-muted-foreground))]">Clock running</span>;
  if (log.stopLat == null || log.stopLng == null) return <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span>{metres(log.stopDistanceM)}{log.stopDistanceM != null ? " from the pin" : ""}{log.stopAccuracyM != null ? ` · ±${Math.round(log.stopAccuracyM)} m` : ""}</span>
      <a className="text-[hsl(var(--e-accent-portal))] hover:underline" href={mapsLink(log.stopLat, log.stopLng)} target="_blank" rel="noreferrer">Map</a>
    </span>
  );
}

export function SegmentLocations({ logs, timeZone }: { logs: SegmentLocationLog[]; timeZone: string }) {
  if (logs.length === 0) return null;
  return (
    <section aria-label="Clock locations by cleaner" className="space-y-2">
      <p className="e-eyebrow">Clock locations by cleaner</p>
      <ul className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
        {logs.map((log) => (
          <li key={log.id} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-3">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="block font-[550]">{log.user?.name ?? log.user?.email ?? "Cleaner"}</span>
              <span className="block text-[0.75rem] tabular-nums text-[hsl(var(--e-muted-foreground))]">
                {formatInTimeZone(log.startedAt, timeZone, "dd MMM HH:mm")}{log.stoppedAt ? `–${formatInTimeZone(log.stoppedAt, timeZone, "HH:mm")}` : " –"}
              </span>
            </span>
            <span className="min-w-0"><span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:hidden">Start: </span><StartCell log={log} timeZone={timeZone} /></span>
            <span className="min-w-0"><span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:hidden">Stop: </span><StopCell log={log} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
