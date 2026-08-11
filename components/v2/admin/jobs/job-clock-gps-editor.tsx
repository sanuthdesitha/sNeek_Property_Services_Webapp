"use client";

// Admin editing for a job's clock segments and GPS check-in/out record —
// Estate (v2) job detail, Activity tab. The server recomputes durationM
// (which drives cleaner pay), audit-logs every change, notifies the cleaner
// and refreshes any already-generated report.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Pencil } from "lucide-react";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import { offSiteReasonLabel, reasonClaimsOnSite } from "@/lib/gps/off-site-reasons";
import { toast } from "@/hooks/use-toast";

export type ClockLogRow = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  durationM: number | null;
  userName: string;
};

export type GpsRecordProps = {
  checkInLat: number | null;
  checkInLng: number | null;
  checkInAt: string | null;
  checkInAccuracyM: number | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  checkOutAt: string | null;
  distanceMeters: number | null;
  adjusted: boolean;
  reasonCode: string | null;
  note: string | null;
};

function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function toDateTimeLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const TH_CLASS =
  "py-2 pr-3 text-left text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]";

export function ClockRecordsEditor({ jobId, timeLogs }: { jobId: string; timeLogs: ClockLogRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [startInput, setStartInput] = useState("");
  const [stopInput, setStopInput] = useState("");
  const [busy, setBusy] = useState(false);
  const editingLog = timeLogs.find((log) => log.id === editingId) ?? null;

  function beginEdit(log: ClockLogRow) {
    setEditingId(log.id);
    setStartInput(toDateTimeLocalInput(log.startedAt));
    setStopInput(toDateTimeLocalInput(log.stoppedAt));
  }

  async function save(log: ClockLogRow) {
    const startedAt = fromDateTimeLocalInput(startInput);
    if (!startedAt) {
      toast({ title: "Clock-in time is required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/time-logs/${log.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startedAt, stoppedAt: fromDateTimeLocalInput(stopInput) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Clock edit failed",
          description: body.error ?? "Could not update the time log.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Clock times updated",
        description:
          body.durationM != null
            ? `New segment duration: ${minutesLabel(body.durationM)}. Cleaner notified; change audit-logged.`
            : "Segment reopened (no clock-out). Cleaner notified; change audit-logged.",
      });
      setEditingId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (timeLogs.length === 0) {
    return (
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No time logs recorded.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-[0.8125rem]">
          <thead>
            <tr className="border-b border-[hsl(var(--e-border))]">
              <th className={TH_CLASS}>Cleaner</th>
              <th className={TH_CLASS}>Clock-in</th>
              <th className={TH_CLASS}>Clock-out</th>
              <th className={`${TH_CLASS} text-right`}>Duration</th>
              <th className={`${TH_CLASS} text-right`}>Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--e-border))]">
            {timeLogs.map((log) => (
              <tr
                key={log.id}
                className={editingId === log.id ? "bg-[hsl(var(--e-surface-2))]" : undefined}
              >
                <td className="py-2 pr-3 font-[550]">{log.userName}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {format(new Date(log.startedAt), "dd MMM HH:mm")}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {log.stoppedAt ? (
                    format(new Date(log.stoppedAt), "dd MMM HH:mm")
                  ) : (
                    <EBadge tone="warning" soft>
                      Not clocked out
                    </EBadge>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {log.durationM != null ? (
                    minutesLabel(log.durationM)
                  ) : (
                    <EBadge tone="info" soft>
                      Active
                    </EBadge>
                  )}
                </td>
                <td className="py-2 text-right">
                  <EButton size="sm" variant="ghost" onClick={() => beginEdit(log)} disabled={busy} aria-label="Edit clock times">
                    <Pencil className="h-4 w-4" />
                  </EButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The edit form lives BELOW the table, stacked and full-width, so it
          never widens the table beyond a phone screen. */}
      {editingLog ? (
        <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-2))] p-3">
          <p className="text-[0.8125rem] font-[600]">Edit clock times — {editingLog.userName}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0 space-y-1">
              <span className="block text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                Clock-in
              </span>
              <EInput
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                className="h-8 w-full"
                disabled={busy}
              />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="block text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                Clock-out
              </span>
              <EInput
                type="datetime-local"
                value={stopInput}
                onChange={(e) => setStopInput(e.target.value)}
                className="h-8 w-full"
                disabled={busy}
              />
              <span className="block text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                Leave empty to mark as not clocked out.
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <EButton size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={busy}>
              Cancel
            </EButton>
            <EButton size="sm" variant="gold" onClick={() => void save(editingLog)} disabled={busy}>
              {busy ? "Saving…" : "Save clock times"}
            </EButton>
          </div>
        </div>
      ) : null}
      <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
        Edits recompute the pay-driving duration, notify the cleaner and are audit-logged. Any
        generated report refreshes automatically.
      </p>
    </div>
  );
}

function parseCoordinate(raw: string, kind: "lat" | "lng"): number | null | undefined {
  if (!raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.abs(value) <= (kind === "lat" ? 90 : 180) ? value : undefined;
}

export function GpsRecordEditor({ jobId, gps }: { jobId: string; gps: GpsRecordProps }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inLat, setInLat] = useState("");
  const [inLng, setInLng] = useState("");
  const [inAt, setInAt] = useState("");
  const [outLat, setOutLat] = useState("");
  const [outLng, setOutLng] = useState("");
  const [outAt, setOutAt] = useState("");

  function beginEdit() {
    setInLat(gps.checkInLat != null ? String(gps.checkInLat) : "");
    setInLng(gps.checkInLng != null ? String(gps.checkInLng) : "");
    setInAt(toDateTimeLocalInput(gps.checkInAt));
    setOutLat(gps.checkOutLat != null ? String(gps.checkOutLat) : "");
    setOutLng(gps.checkOutLng != null ? String(gps.checkOutLng) : "");
    setOutAt(toDateTimeLocalInput(gps.checkOutAt));
    setEditing(true);
  }

  async function save() {
    const checkInLat = parseCoordinate(inLat, "lat");
    const checkInLng = parseCoordinate(inLng, "lng");
    const checkOutLat = parseCoordinate(outLat, "lat");
    const checkOutLng = parseCoordinate(outLng, "lng");
    if ([checkInLat, checkInLng, checkOutLat, checkOutLng].includes(undefined)) {
      toast({
        title: "Invalid coordinates",
        description: "Latitude must be within ±90 and longitude within ±180.",
        variant: "destructive",
      });
      return;
    }
    if ((checkInLat === null) !== (checkInLng === null) || (checkOutLat === null) !== (checkOutLng === null)) {
      toast({
        title: "Incomplete coordinates",
        description: "Set or clear latitude and longitude together.",
        variant: "destructive",
      });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/gps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkIn: { lat: checkInLat, lng: checkInLng, at: fromDateTimeLocalInput(inAt) },
          checkOut: { lat: checkOutLat, lng: checkOutLng, at: fromDateTimeLocalInput(outAt) },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "GPS edit failed",
          description: body.error ?? "Could not update the GPS record.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "GPS record updated", description: "Marked as admin-adjusted and audit-logged." });
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const gpsField = (label: string, value: string, onChange: (v: string) => void, type?: string) => (
    <label className="block space-y-1">
      <span className="block text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
        {label}
      </span>
      <EInput
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
        disabled={busy}
        placeholder={type ? undefined : label.startsWith("Lat") ? "-33.8688" : "151.2093"}
      />
    </label>
  );

  const hasCheckIn = gps.checkInLat != null && gps.checkInLng != null;

  return (
    <div className="min-w-0 space-y-1 break-words rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex flex-wrap items-center gap-2 font-[600] text-[hsl(var(--e-foreground))]">
          GPS record
          {gps.adjusted ? (
            <EBadge tone="warning" soft>
              Adjusted by admin
            </EBadge>
          ) : null}
        </span>
        {!editing ? (
          <EButton size="sm" variant="ghost" onClick={beginEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
          </EButton>
        ) : null}
      </div>

      {hasCheckIn ? (
        <p>
          Clock-in GPS:{" "}
          <a
            className="text-[hsl(var(--e-accent-portal))] hover:underline"
            href={mapsLink(gps.checkInLat!, gps.checkInLng!)}
            target="_blank"
            rel="noreferrer"
          >
            {gps.checkInLat!.toFixed(5)}, {gps.checkInLng!.toFixed(5)}
          </a>
          {gps.checkInAt ? ` · ${format(new Date(gps.checkInAt), "dd MMM HH:mm")}` : ""}
          {gps.checkInAccuracyM != null ? ` · ±${Math.round(gps.checkInAccuracyM)}m` : ""}
        </p>
      ) : (
        <p>No GPS check-in recorded.</p>
      )}
      {gps.checkOutLat != null && gps.checkOutLng != null ? (
        <p>
          Clock-out GPS:{" "}
          <a
            className="text-[hsl(var(--e-accent-portal))] hover:underline"
            href={mapsLink(gps.checkOutLat, gps.checkOutLng)}
            target="_blank"
            rel="noreferrer"
          >
            {gps.checkOutLat.toFixed(5)}, {gps.checkOutLng.toFixed(5)}
          </a>
          {gps.checkOutAt ? ` · ${format(new Date(gps.checkOutAt), "dd MMM HH:mm")}` : ""}
        </p>
      ) : null}
      {gps.distanceMeters != null ? <p>Distance from property at clock-in: {gps.distanceMeters}m</p> : null}
      {/* An off-site start is an attributable act, not a number nobody reads —
          show the reason the cleaner had to give. */}
      {gps.reasonCode ? (
        <p className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-surface-2))] px-2.5 py-2">
          <span className="font-[600]">
            {reasonClaimsOnSite(gps.reasonCode)
              ? "Started away from the pin (says they were on site)"
              : "Started away from the property"}
          </span>
          <br />
          {offSiteReasonLabel(gps.reasonCode)}
          {gps.note ? ` — ${gps.note}` : ""}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-2 space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-2))] p-3">
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
              Check-in
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {gpsField("Latitude", inLat, setInLat)}
              {gpsField("Longitude", inLng, setInLng)}
              {gpsField("Time", inAt, setInAt, "datetime-local")}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
              Check-out
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {gpsField("Latitude", outLat, setOutLat)}
              {gpsField("Longitude", outLng, setOutLng)}
              {gpsField("Time", outAt, setOutAt, "datetime-local")}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <EButton size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </EButton>
            <EButton size="sm" variant="gold" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save GPS record"}
            </EButton>
          </div>
          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
            Leave a pair empty to clear that point. Changes mark the record as admin-adjusted and are
            audit-logged.
          </p>
        </div>
      ) : null}
    </div>
  );
}
