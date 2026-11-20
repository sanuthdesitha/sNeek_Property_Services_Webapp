"use client";

/**
 * Property › Care and planning › Devices (2026-11-20). The property's battery
 * devices (Ring, Minut, or added by hand): battery, how old the reading is and
 * who gave it, status (OK / low / out of date / not known / offline), the open
 * charge task and its clean, and the hand-entry tools that always work with no
 * provider connected.
 *
 * Rendered inside the property page's lazy disclosure, so it loads only when
 * opened; the parent keys it by property, so a different property starts
 * fresh. Reads are cancelled when superseded; each form freezes while it saves
 * and keeps its draft (and its request id, so a retry is not a second reading)
 * when a save fails.
 */
import * as React from "react";
import Link from "next/link";
import { EButton, EAlert } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import {
  batteryText,
  CONDITION_LABEL,
  DEVICE_KINDS,
  KIND_LABEL,
  PROVIDER_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  type DeviceBatteryStatus,
  type DeviceKind,
  type DeviceReadingView,
  type PropertyDeviceView,
} from "@/lib/property-devices/types";

type Viewer = { isAdmin: boolean; canManage: boolean };
type PanelData = { devices: PropertyDeviceView[]; propertyThresholdPercent: number | null; organisationThresholdPercent: number; staleAfterHours: number; viewer: Viewer };
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: PanelData; refreshing: boolean; refreshError: string | null };

const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";

const STATUS_TONE: Record<DeviceBatteryStatus, EPillTone> = {
  OK: "ok",
  LOW: "bad",
  STALE: "warn",
  UNKNOWN: "neutral",
  OFFLINE: "bad",
  WIRED: "neutral",
  INACTIVE: "neutral",
};

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function formatWhen(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ageText(value: string | null, now: number): string {
  if (!value) return "No reading";
  const hours = Math.max(0, Math.round((now - new Date(value).getTime()) / 3_600_000));
  if (hours < 1) return "Less than an hour ago";
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  return ((await response.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
}

async function sendJson(url: string, method: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await readBody(response);
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "That was not saved.");
  return body;
}

/* ── Enter a reading ────────────────────────────────────────────────────── */

type ReadingDraft = { percent: string; note: string; requestId: string };

function ReadingForm({ propertyId, device, onDone }: { propertyId: string; device: PropertyDeviceView; onDone: (message: string) => void }) {
  const [draft, setDraft] = React.useState<ReadingDraft>(() => ({ percent: "", note: "", requestId: newRequestId() }));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = `reading-${device.id}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const percent = Number(draft.percent);
    if (!/^\d{1,3}$/.test(draft.percent) || percent > 100) {
      setError("Enter the battery as a whole number from 0 to 100.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = await sendJson(`/api/admin/properties/${propertyId}/devices/${device.id}/readings`, "POST", { requestId: draft.requestId, percent, note: draft.note.trim() || null });
      const decision = (body.decision ?? {}) as { action?: string; reason?: string };
      setDraft({ percent: "", note: "", requestId: newRequestId() });
      onDone(decision.action === "RAISE" || decision.action === "ENSURE_TASK" ? `Saved. ${decision.reason ?? ""} A charge task was put on the next clean.` : decision.action === "CLOSE_RECOVERED" ? `Saved. ${decision.reason ?? ""} The charge is closed.` : "Reading saved.");
    } catch (failure) {
      // The draft and its request id stay, so trying again cannot record it twice.
      setError(`${failure instanceof Error ? failure.message : "Not saved."} Your entry is still here.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3">
      <fieldset disabled={saving} className="flex flex-wrap items-end gap-2">
        <EField label="Battery now (%)" className="w-[9rem]">
          <EInput id={inputId} inputMode="numeric" maxLength={3} value={draft.percent} onChange={(event) => setDraft((current) => ({ ...current, percent: event.target.value.replace(/\D/g, "") }))} />
        </EField>
        <EField label="Note (optional)" className="min-w-0 flex-1 basis-[12rem]">
          <EInput value={draft.note} maxLength={500} placeholder="e.g. Seen in the Ring app" onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} />
        </EField>
        <EButton type="submit" size="sm" disabled={!draft.percent}>{saving ? "Saving…" : "Save reading"}</EButton>
      </fieldset>
      {error ? <p role="alert" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </form>
  );
}

/* ── Readings history ───────────────────────────────────────────────────── */

function ReadingHistory({ propertyId, deviceId, timeZone, version }: { propertyId: string; deviceId: string; timeZone: string; version: number }) {
  const [state, setState] = React.useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; readings: DeviceReadingView[] }>({ status: "loading" });
  React.useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/admin/properties/${propertyId}/devices/${deviceId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await readBody(response);
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not load the history.");
        setState({ status: "ready", readings: (body.readings as DeviceReadingView[]) ?? [] });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Could not load the history." });
      });
    return () => controller.abort();
  }, [propertyId, deviceId, version]);

  if (state.status === "loading") return <p role="status" className={MUTED}>Loading history…</p>;
  if (state.status === "error") return <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{state.message}</p>;
  if (state.readings.length === 0) return <p className={MUTED}>No readings yet.</p>;
  return (
    <ul className="mt-2 space-y-1 text-[0.8125rem]">
      {state.readings.map((reading) => (
        <li key={reading.id} className="flex flex-wrap gap-x-3 break-words">
          <span className="e-tnum font-[600]">{reading.percent}%</span>
          <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{formatWhen(reading.readAt, timeZone)}</span>
          <span>{SOURCE_LABEL[reading.source]}{reading.recordedByName ? ` · ${reading.recordedByName}` : ""}</span>
          {reading.note ? <span className="text-[hsl(var(--e-muted-foreground))]">{reading.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/* ── Add or edit a device ───────────────────────────────────────────────── */

type DeviceDraft = { name: string; kind: DeviceKind; locationNote: string; batteryPowered: boolean; thresholdPercent: string; isActive: boolean };

function draftFrom(device: PropertyDeviceView | null): DeviceDraft {
  return {
    name: device?.name ?? "",
    kind: device?.kind ?? "CAMERA",
    locationNote: device?.locationNote ?? "",
    batteryPowered: device?.batteryPowered ?? true,
    thresholdPercent: device?.thresholdPercent == null ? "" : String(device.thresholdPercent),
    isActive: device?.isActive ?? true,
  };
}

function DeviceForm({ propertyId, device, viewer, onDone, onCancel }: { propertyId: string; device: PropertyDeviceView | null; viewer: Viewer; onDone: (message: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = React.useState<DeviceDraft>(() => draftFrom(device));
  const [requestId] = React.useState(newRequestId);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof DeviceDraft>(key: K, value: DeviceDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const threshold = draft.thresholdPercent.trim() === "" ? null : Number(draft.thresholdPercent);
    if (threshold !== null && (!Number.isInteger(threshold) || threshold < 1 || threshold > 99)) {
      setError("Enter the device's own threshold as 1 to 99, or leave it empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const shared = { name: draft.name.trim(), kind: draft.kind, locationNote: draft.locationNote.trim() || null, batteryPowered: draft.batteryPowered };
      const thresholdPart = viewer.isAdmin ? { thresholdPercent: threshold } : {};
      if (device) {
        // Guarded by the device's last change as listed: a change made elsewhere since is refused, not overwritten.
        await sendJson(`/api/admin/properties/${propertyId}/devices/${device.id}`, "PATCH", { expectedUpdatedAt: device.updatedAt, ...shared, ...thresholdPart, isActive: draft.isActive });
        onDone("Device saved.");
      } else {
        await sendJson(`/api/admin/properties/${propertyId}/devices`, "POST", { requestId, ...shared, ...thresholdPart });
        onDone("Device added. Enter its battery level when you know it.");
      }
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : "Not saved."} Your changes are still here.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <fieldset disabled={saving} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EField label="Name"><EInput value={draft.name} maxLength={120} placeholder="e.g. Front door" onChange={(event) => set("name", event.target.value)} /></EField>
          <EField label="Kind">
            <ESelect value={draft.kind} onChange={(event) => set("kind", event.target.value as DeviceKind)}>
              {DEVICE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
            </ESelect>
          </EField>
          <EField label="Where it is (optional)" className="sm:col-span-2"><EInput value={draft.locationNote} maxLength={300} placeholder="e.g. Above the front door, charger in the laundry cupboard" onChange={(event) => set("locationNote", event.target.value)} /></EField>
          {viewer.isAdmin ? (
            <EField label="Its own low-battery threshold (%)" hint="Empty: the property's or the organisation's.">
              <EInput inputMode="numeric" maxLength={2} value={draft.thresholdPercent} onChange={(event) => set("thresholdPercent", event.target.value.replace(/\D/g, ""))} />
            </EField>
          ) : null}
        </div>
        <ESwitch checked={draft.batteryPowered} onCheckedChange={(value) => set("batteryPowered", value)} label="Runs on a battery (wired devices never get charge tasks)" />
        {device ? <ESwitch checked={draft.isActive} onCheckedChange={(value) => set("isActive", value)} label="In use at this property" /> : null}
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <EButton type="submit" size="sm" disabled={!draft.name.trim()}>{saving ? "Saving…" : device ? "Save device" : "Add device"}</EButton>
          <EButton type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</EButton>
        </div>
      </fieldset>
    </form>
  );
}

/* ── Close a charge ─────────────────────────────────────────────────────── */

function CloseChargeForm({ propertyId, deviceId, onDone, onCancel }: { propertyId: string; deviceId: string; onDone: (message: string) => void; onCancel: () => void }) {
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/admin/properties/${propertyId}/devices/${deviceId}/close`, "POST", { note: note.trim() });
      onDone("Charge closed. Its open task was cancelled.");
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : "Not saved."} Your note is still here.`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-3">
      <fieldset disabled={saving} className="space-y-2">
        <EField label="Why the charge is no longer needed"><ETextarea rows={2} value={note} maxLength={500} placeholder="e.g. Device replaced with a wired one" onChange={(event) => setNote(event.target.value)} /></EField>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <EButton type="submit" size="sm" disabled={!note.trim()}>{saving ? "Closing…" : "Close the charge"}</EButton>
          <EButton type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</EButton>
        </div>
      </fieldset>
    </form>
  );
}

/* ── One device ─────────────────────────────────────────────────────────── */

type DeviceTool = "reading" | "history" | "edit" | "close" | null;

function ChargeLine({ device }: { device: PropertyDeviceView }) {
  if (device.chargeCondition === "NONE") return null;
  return (
    <div className="mt-2 space-y-1 text-[0.8125rem]">
      <p className="font-[550]">{CONDITION_LABEL[device.chargeCondition]}</p>
      {device.chargeTask?.jobId ? (
        <p>Charge task on the clean {device.chargeTask.jobDay ? `of ${device.chargeTask.jobDay}` : ""}: <Link className="underline" href={`/v2/admin/jobs/${device.chargeTask.jobId}`}>{device.chargeTask.jobNumber ?? "open the job"}</Link></p>
      ) : null}
      {device.noCleanScheduled ? <p className="text-[hsl(var(--e-warning))]">No clean is scheduled here. The task goes on the next clean as soon as one exists.</p> : null}
      {device.chargeCondition === "NEEDS_CHARGE" && device.lastCouldNotChargeNote ? <p>Last clean could not charge it: {device.lastCouldNotChargeNote}</p> : null}
    </div>
  );
}

function DeviceRow({ propertyId, device, viewer, timeZone, now, onChanged }: { propertyId: string; device: PropertyDeviceView; viewer: Viewer; timeZone: string; now: number; onChanged: (message: string) => void }) {
  const [tool, setTool] = React.useState<DeviceTool>(null);
  const [historyVersion, setHistoryVersion] = React.useState(0);
  const toggle = (next: DeviceTool) => setTool((current) => (current === next ? null : next));
  const done = (message: string) => {
    setTool(null);
    setHistoryVersion((value) => value + 1);
    onChanged(message);
  };
  return (
    <li className="border-t border-[hsl(var(--e-border))] py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[0.875rem] font-[600]">{device.name}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{KIND_LABEL[device.kind]} · {PROVIDER_LABEL[device.provider]}{device.locationNote ? ` · ${device.locationNote}` : ""}</p>
        </div>
        <EPill tone={STATUS_TONE[device.status]}>{STATUS_LABEL[device.status]}</EPill>
      </div>
      {device.batteryPowered ? (
        <p className="mt-1 text-[0.8125rem]">
          <span className="e-tnum font-[600]">{batteryText(device.lastBatteryPercent)}</span>
          {device.lastReadingAt ? <> · <span title={formatWhen(device.lastReadingAt, timeZone)}>{ageText(device.lastReadingAt, now)}</span> ({formatWhen(device.lastReadingAt, timeZone)}){device.lastReadingSource ? ` · ${SOURCE_LABEL[device.lastReadingSource]}` : ""}</> : " · no reading yet"}
          {` · charge at ${device.effectiveThresholdPercent}% or below`}
        </p>
      ) : null}
      <ChargeLine device={device} />
      <div className="mt-2 flex flex-wrap gap-2">
        {viewer.canManage && device.isActive && device.batteryPowered ? <EButton size="sm" variant="outline" aria-expanded={tool === "reading"} onClick={() => toggle("reading")}>Enter reading</EButton> : null}
        <EButton size="sm" variant="outline" aria-expanded={tool === "history"} onClick={() => toggle("history")}>History</EButton>
        {viewer.canManage ? <EButton size="sm" variant="outline" aria-expanded={tool === "edit"} onClick={() => toggle("edit")}>Edit</EButton> : null}
        {viewer.canManage && device.chargeCondition !== "NONE" ? <EButton size="sm" variant="outline" aria-expanded={tool === "close"} onClick={() => toggle("close")}>Close the charge</EButton> : null}
      </div>
      {tool === "reading" ? <ReadingForm propertyId={propertyId} device={device} onDone={done} /> : null}
      {tool === "history" ? <ReadingHistory propertyId={propertyId} deviceId={device.id} timeZone={timeZone} version={historyVersion} /> : null}
      {tool === "edit" ? <div className="mt-3"><DeviceForm propertyId={propertyId} device={device} viewer={viewer} onDone={done} onCancel={() => setTool(null)} /></div> : null}
      {tool === "close" ? <CloseChargeForm propertyId={propertyId} deviceId={device.id} onDone={done} onCancel={() => setTool(null)} /> : null}
    </li>
  );
}

/* ── Property threshold (administrators) ────────────────────────────────── */

function PropertyThreshold({ propertyId, value, organisation, onDone }: { propertyId: string; value: number | null; organisation: number; onDone: (message: string) => void }) {
  const [draft, setDraft] = React.useState(value == null ? "" : String(value));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const threshold = draft.trim() === "" ? null : Number(draft);
    if (threshold !== null && (!Number.isInteger(threshold) || threshold < 1 || threshold > 99)) {
      setError("Enter 1 to 99, or leave it empty for the organisation's.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/admin/properties/${propertyId}/device-settings`, "PATCH", { thresholdPercent: threshold });
      onDone("Property threshold saved.");
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : "Not saved."} Your entry is still here.`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={saving} className="flex flex-wrap items-end gap-2">
        <EField label="This property's low-battery threshold (%)" hint={`Empty: the organisation's ${organisation}%.`} className="w-[16rem] max-w-full">
          <EInput inputMode="numeric" maxLength={2} value={draft} onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))} />
        </EField>
        <EButton type="submit" size="sm" variant="outline" disabled={draft === (value == null ? "" : String(value))}>{saving ? "Saving…" : "Save"}</EButton>
      </fieldset>
      {error ? <p role="alert" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </form>
  );
}

/* ── The panel ──────────────────────────────────────────────────────────── */

export function PropertyDevicesPanel({ propertyId, timeZone }: { propertyId: string; timeZone: string }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [adding, setAdding] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const requestRef = React.useRef<AbortController | null>(null);

  const reload = React.useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoad((current) => (current.status === "ready" ? { ...current, refreshing: true, refreshError: null } : { status: "loading" }));
    try {
      const response = await fetch(`/api/admin/properties/${propertyId}/devices`, { cache: "no-store", signal: controller.signal });
      const body = await readBody(response);
      if (controller.signal.aborted) return;
      if (!response.ok || !Array.isArray(body.devices)) throw new Error(typeof body.error === "string" ? body.error : "Could not load the devices.");
      setLoad({ status: "ready", data: body as unknown as PanelData, refreshing: false, refreshError: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Could not load the devices.";
      // Keep what was shown, marked as possibly out of date, rather than clearing it.
      setLoad((current) => (current.status === "ready" ? { ...current, refreshing: false, refreshError: message } : { status: "error", message }));
    }
  }, [propertyId]);

  React.useEffect(() => {
    void reload();
    return () => requestRef.current?.abort();
  }, [reload]);

  const changed = (message: string) => {
    setNotice(message);
    setAdding(false);
    void reload();
  };

  if (load.status === "loading") return <p role="status" className={MUTED}>Loading devices…</p>;
  if (load.status === "error") {
    return (
      <EAlert tone="danger" title="Devices could not be loaded">
        {load.message} <EButton size="sm" variant="outline" onClick={() => void reload()}>Try again</EButton>
      </EAlert>
    );
  }
  const { data } = load;
  const now = Date.now();
  return (
    <div className="min-w-0 space-y-3">
      <p className={MUTED}>
        A battery device at or below its threshold gets one high-priority charge task on the next clean here. Readings older than {data.staleAfterHours} hours are shown as out of date and neither raise nor clear a charge. Ring and Minut connect in Settings; anything can be added and read here by hand.
      </p>
      {load.refreshError ? <EAlert tone="warning">Could not refresh: {load.refreshError} What you see may be out of date.</EAlert> : null}
      {notice ? <div aria-live="polite"><EAlert tone="success">{notice}</EAlert></div> : null}
      {data.devices.length === 0 ? <p className={MUTED}>No devices recorded at this property yet.</p> : (
        <ul aria-busy={load.refreshing}>
          {data.devices.map((device) => <DeviceRow key={device.id} propertyId={propertyId} device={device} viewer={data.viewer} timeZone={timeZone} now={now} onChanged={changed} />)}
        </ul>
      )}
      {data.viewer.canManage ? (
        adding ? <DeviceForm propertyId={propertyId} device={null} viewer={data.viewer} onDone={changed} onCancel={() => setAdding(false)} /> : <EButton size="sm" variant="outline" onClick={() => setAdding(true)}>Add a device</EButton>
      ) : null}
      {data.viewer.isAdmin ? <PropertyThreshold propertyId={propertyId} value={data.propertyThresholdPercent} organisation={data.organisationThresholdPercent} onDone={changed} /> : null}
    </div>
  );
}
