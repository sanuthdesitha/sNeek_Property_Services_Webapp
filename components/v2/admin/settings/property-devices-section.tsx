"use client";

/**
 * Settings › Operations › Ring and Minut devices (2026-11-20). Administrators.
 *
 * - Thresholds and timings: low battery at or below (default 25%), readings
 *   out of date after (48 h), cool-down after a charge (72 h), how often each
 *   provider is read (6 h), and after how many failed syncs the office is told (3).
 * - Ring: the custom, read-only connection, with the permanent warning that it
 *   is not official. Connect with a separate shared Ring account and a 2FA code.
 * - Minut: the official API. Says exactly what is missing until the client id
 *   and secret are entered; "Not connected" until they work.
 * - Locations: each Ring location / Minut home and the property it is linked
 *   to. A suggestion is only a suggestion until "Link" is pressed.
 * - Recent runs, in the organisation's timezone.
 *
 * Connecting, changing the Minut credentials and disconnecting are confirmed
 * with the person's own PIN (tier C). The Ring password and code stay in this
 * form's memory only for the two sign-in requests; they are cleared after a
 * connection and never saved in the browser.
 */
import * as React from "react";
import { ECard, ECardBody, ECardHeader, ECardTitle, EButton, EAlert } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { EPill } from "@/components/v2/ui/pill";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import { PROVIDER_LABEL, RING_UNOFFICIAL_WARNING, type ConnectedProvider, type PropertyDeviceSettings, type ProviderConnectionView, type ProviderLocationView } from "@/lib/property-devices/types";

type SyncRunRow = { id: string; provider: ConnectedProvider | null; mode: string; status: string; error: string | null; createdAt: string; completedAt: string | null; summary: Record<string, unknown> | null };
type PropertyOption = { id: string; name: string; suburb: string | null };
type Loaded = { settings: PropertyDeviceSettings; connections: ProviderConnectionView[]; locations: ProviderLocationView[]; runs: SyncRunRow[]; properties: PropertyOption[] };
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Loaded };
type Message = { tone: "success" | "danger" | "info"; text: string } | null;

const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";

function formatWhen(value: string | null, timeZone: string): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-AU", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  return ((await response.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
}

function errorText(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

/* ── Thresholds and timings ─────────────────────────────────────────────── */

type SettingsForm = Record<keyof PropertyDeviceSettings, string>;

const SETTING_FIELDS: Array<{ key: keyof PropertyDeviceSettings; label: string; hint: string; min: number; max: number }> = [
  { key: "defaultThresholdPercent", label: "Low battery at or below (%)", hint: "Default 25. Properties and devices can have their own.", min: 1, max: 99 },
  { key: "staleAfterHours", label: "Reading out of date after (hours)", hint: "Default 48. An out-of-date reading never raises or clears a charge.", min: 1, max: 720 },
  { key: "cooldownHours", label: "Wait after a charge (hours)", hint: "Default 72. Before raising again if the battery has not recovered.", min: 1, max: 720 },
  { key: "pollIntervalHours", label: "Read Ring and Minut every (hours)", hint: "Default 6.", min: 1, max: 168 },
  { key: "failureNoticeAfter", label: "Tell the office after failed syncs in a row", hint: "Default 3. Told once per outage, in the inbox.", min: 1, max: 50 },
];

function settingsForm(settings: PropertyDeviceSettings): SettingsForm {
  return Object.fromEntries(SETTING_FIELDS.map((field) => [field.key, String(settings[field.key])])) as SettingsForm;
}

function ThresholdsCard({ saved, onSaved }: { saved: PropertyDeviceSettings; onSaved: (settings: PropertyDeviceSettings) => void }) {
  const [form, setForm] = React.useState<SettingsForm>(() => settingsForm(saved));
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<Message>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(settingsForm(saved));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload: Partial<PropertyDeviceSettings> = {};
    for (const field of SETTING_FIELDS) {
      const value = Number(form[field.key]);
      if (!Number.isInteger(value) || value < field.min || value > field.max) {
        setMessage({ tone: "danger", text: `${field.label}: enter a whole number from ${field.min} to ${field.max}.` });
        return;
      }
      payload[field.key] = value;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/integrations/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await readBody(response);
      if (!response.ok) throw new Error(errorText(body, "The settings were not saved."));
      onSaved(body.settings as PropertyDeviceSettings);
      setForm(settingsForm(body.settings as PropertyDeviceSettings));
      setMessage({ tone: "success", text: "Saved. Devices are checked again within the hour." });
    } catch (error) {
      setMessage({ tone: "danger", text: `${error instanceof Error ? error.message : "The settings were not saved."} Your changes are still here.` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader className="p-5 pb-0"><ECardTitle className="text-[1rem]">Low battery and timings</ECardTitle></ECardHeader>
      <ECardBody className="p-5">
        <form onSubmit={submit}>
          <fieldset disabled={saving} className="space-y-4">
            <p className={MUTED}>A battery device at or below its threshold gets one high-priority charge task on the next clean at its property. Wired devices never do. Unknown battery shows as &ldquo;Not known&rdquo;, never 0%.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SETTING_FIELDS.map((field) => (
                <EField key={field.key} label={field.label} hint={field.hint}>
                  <EInput type="number" min={field.min} max={field.max} step={1} value={form[field.key]} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                </EField>
              ))}
            </div>
            {message ? <EAlert tone={message.tone}>{message.text}</EAlert> : null}
            <EButton type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</EButton>
          </fieldset>
        </form>
      </ECardBody>
    </ECard>
  );
}

/* ── Connection status ──────────────────────────────────────────────────── */

function StatusPill({ connection }: { connection: ProviderConnectionView }) {
  if (connection.status === "NEEDS_RECONNECT") return <EPill tone="bad">Needs reconnecting</EPill>;
  if (connection.status === "NOT_CONNECTED") return <EPill tone="neutral">Not connected</EPill>;
  if (connection.failing) return <EPill tone="bad">Connected, syncs failing</EPill>;
  return <EPill tone="ok">Connected</EPill>;
}

function ConnectionFacts({ connection, timeZone }: { connection: ProviderConnectionView; timeZone: string }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[0.8125rem] sm:grid-cols-2">
      <div className="flex gap-2"><dt className="text-[hsl(var(--e-muted-foreground))]">Account</dt><dd className="min-w-0 break-words">{connection.accountLabel ?? "None"}</dd></div>
      <div className="flex gap-2"><dt className="text-[hsl(var(--e-muted-foreground))]">Last good sync</dt><dd>{formatWhen(connection.lastSuccessAt, timeZone)}</dd></div>
      {connection.lastError ? (
        <div className="flex gap-2 sm:col-span-2"><dt className="shrink-0 text-[hsl(var(--e-muted-foreground))]">Last problem</dt><dd className="min-w-0 break-words">{connection.lastError} ({formatWhen(connection.lastErrorAt, timeZone)}{connection.consecutiveFailures > 0 ? `, ${connection.consecutiveFailures} in a row` : ""})</dd></div>
      ) : null}
    </dl>
  );
}

type ConnectionActions = {
  busy: string | null;
  pinReady: boolean;
  syncNow: (provider: ConnectedProvider) => void;
  disconnect: (provider: ConnectedProvider) => void;
};

function ConnectedActions({ provider, connection, actions }: { provider: ConnectedProvider; connection: ProviderConnectionView; actions: ConnectionActions }) {
  if (connection.status === "NOT_CONNECTED") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {connection.status === "CONNECTED" ? <EButton variant="outline" size="sm" disabled={actions.busy !== null} onClick={() => actions.syncNow(provider)}>{actions.busy === `sync-${provider}` ? "Syncing…" : "Sync now"}</EButton> : null}
      <EButton variant="outline" size="sm" disabled={actions.busy !== null || !actions.pinReady} onClick={() => actions.disconnect(provider)}>{actions.busy === `disconnect-${provider}` ? "Disconnecting…" : `Disconnect ${PROVIDER_LABEL[provider]}`}</EButton>
    </div>
  );
}

/* ── Ring ───────────────────────────────────────────────────────────────── */

type RingDraft = { email: string; password: string; code: string; prompt: string | null };
const EMPTY_RING: RingDraft = { email: "", password: "", code: "", prompt: null };

function RingCard({ connection, timeZone, actions, connect }: { connection: ProviderConnectionView; timeZone: string; actions: ConnectionActions; connect: (draft: RingDraft) => Promise<{ prompt?: string; connected?: boolean } | null> }) {
  const [draft, setDraft] = React.useState<RingDraft>(EMPTY_RING);
  const connecting = actions.busy === "connect-RING";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await connect(draft);
    if (result?.prompt) setDraft((current) => ({ ...current, prompt: result.prompt ?? null, code: "" }));
    if (result?.connected) setDraft(EMPTY_RING);
  }

  return (
    <ECard>
      <ECardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-5 pb-0">
        <ECardTitle className="text-[1rem]">Ring cameras and doorbells</ECardTitle>
        <StatusPill connection={connection} />
      </ECardHeader>
      <ECardBody className="space-y-4 p-5">
        <EAlert tone="warning" title="Not an official connection">{RING_UNOFFICIAL_WARNING}</EAlert>
        <ConnectionFacts connection={connection} timeZone={timeZone} />
        {connection.missing.length ? <EAlert tone="danger" title="Needed first">{connection.missing.join("; ")}.</EAlert> : null}
        <ConnectedActions provider="RING" connection={connection} actions={actions} />
        {connection.status !== "CONNECTED" ? (
          <form onSubmit={submit}>
            <fieldset disabled={connecting || connection.missing.length > 0} className="space-y-3">
              <p className={MUTED}>Use a separate Ring account added as a shared user on each location, never the owner&rsquo;s own login. Only Ring&rsquo;s renewal key is kept (encrypted); the password and code are not saved. sNeek reads the device list, battery and connection only: never video, snapshots, live view, history or settings.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <EField label="Shared account email"><EInput type="email" autoComplete="off" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></EField>
                <EField label="Shared account password"><EInput type="password" autoComplete="new-password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} /></EField>
              </div>
              {draft.prompt ? (
                <EField label="Code from Ring" hint={draft.prompt} className="max-w-[16rem]">
                  <EInput inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value.replace(/\D/g, "") }))} />
                </EField>
              ) : null}
              <EButton type="submit" disabled={!draft.email || !draft.password || !actions.pinReady || (Boolean(draft.prompt) && draft.code.length < 4)}>
                {connecting ? "Connecting…" : draft.prompt ? "Connect with this code" : "Send me a code"}
              </EButton>
            </fieldset>
          </form>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

/* ── Minut ──────────────────────────────────────────────────────────────── */

type MinutDraft = { clientId: string; clientSecret: string };

function MinutCard({ connection, timeZone, actions, connect }: { connection: ProviderConnectionView; timeZone: string; actions: ConnectionActions; connect: (draft: MinutDraft) => Promise<boolean> }) {
  const [draft, setDraft] = React.useState<MinutDraft>({ clientId: "", clientSecret: "" });
  const connecting = actions.busy === "connect-MINUT";
  const needsCredentials = connection.missing.length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (await connect(draft)) setDraft({ clientId: "", clientSecret: "" });
  }

  return (
    <ECard>
      <ECardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-5 pb-0">
        <ECardTitle className="text-[1rem]">Minut noise sensors</ECardTitle>
        <StatusPill connection={connection} />
      </ECardHeader>
      <ECardBody className="space-y-4 p-5">
        <p className={MUTED}>Minut has an official API. sNeek reads homes, sensors and battery only.</p>
        {needsCredentials ? (
          <EAlert tone="info" title="What is needed">
            Minut API access gives you a client id and a client secret (ask Minut support for API access on your account, then create an API client in Minut). Missing now: {connection.missing.join(", ")}. Enter them below; they are kept with the other integration credentials and the secret is never shown again.
          </EAlert>
        ) : null}
        <ConnectionFacts connection={connection} timeZone={timeZone} />
        <ConnectedActions provider="MINUT" connection={connection} actions={actions} />
        <form onSubmit={submit}>
          <fieldset disabled={connecting} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <EField label="Minut API client id"><EInput autoComplete="off" value={draft.clientId} placeholder={needsCredentials ? "" : "Saved (enter to replace)"} onChange={(event) => setDraft((current) => ({ ...current, clientId: event.target.value }))} /></EField>
              <EField label="Minut API client secret"><EInput type="password" autoComplete="new-password" value={draft.clientSecret} placeholder={needsCredentials ? "" : "Saved (enter to replace)"} onChange={(event) => setDraft((current) => ({ ...current, clientSecret: event.target.value }))} /></EField>
            </div>
            <EButton type="submit" disabled={!actions.pinReady || (needsCredentials ? !draft.clientId || !draft.clientSecret : Boolean(draft.clientId) !== Boolean(draft.clientSecret))}>
              {connecting ? "Checking…" : draft.clientId ? "Save and check" : "Check and connect"}
            </EButton>
          </fieldset>
        </form>
      </ECardBody>
    </ECard>
  );
}

/* ── Locations ──────────────────────────────────────────────────────────── */

function LocationRow({ location, properties, busy, onLink }: { location: ProviderLocationView; properties: PropertyOption[]; busy: boolean; onLink: (locationId: string, propertyId: string | null) => void }) {
  const [choice, setChoice] = React.useState<string>(location.propertyId ?? location.suggestion?.propertyId ?? "");
  React.useEffect(() => setChoice(location.propertyId ?? location.suggestion?.propertyId ?? ""), [location.propertyId, location.suggestion?.propertyId]);
  const selectId = `device-location-${location.id}`;
  return (
    <li className="space-y-2 border-t border-[hsl(var(--e-border))] py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <EPill tone="neutral">{PROVIDER_LABEL[location.provider]}</EPill>
        <span className="min-w-0 break-words text-[0.875rem] font-[550]">{location.name}</span>
        {location.address ? <span className="min-w-0 break-words text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{location.address}</span> : null}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {location.propertyName ? `Linked to ${location.propertyName}.` : location.suggestion ? `Suggested: ${location.suggestion.propertyName} (by name or address). Not linked until you press Link.` : "Not linked. Its devices are not added until you link it."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={selectId} className="sr-only">Property for {location.name}</label>
        <ESelect id={selectId} value={choice} disabled={busy} onChange={(event) => setChoice(event.target.value)} className="min-w-0 max-w-full sm:w-[18rem]">
          <option value="">Choose a property</option>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.name}{property.suburb ? ` (${property.suburb})` : ""}</option>)}
        </ESelect>
        <EButton size="sm" disabled={busy || !choice || choice === location.propertyId} onClick={() => onLink(location.id, choice)}>Link</EButton>
        {location.propertyId ? <EButton size="sm" variant="outline" disabled={busy} onClick={() => onLink(location.id, null)}>Unlink</EButton> : null}
      </div>
    </li>
  );
}

function runLine(run: SyncRunRow): string {
  const who = run.provider ? PROVIDER_LABEL[run.provider] : "Device check";
  const how = run.mode === "MANUAL" ? "Sync now" : "Scheduled";
  const summary = run.summary ?? {};
  const facts = run.provider
    ? `${Number(summary.devicesSeen ?? 0)} devices, ${Number(summary.readingsRecorded ?? 0)} readings, ${Number(summary.tasksRaised ?? 0)} charge tasks`
    : `${Number(summary.devicesEvaluated ?? 0)} devices checked, ${Number(summary.tasksRaised ?? 0)} charge tasks, ${Number(summary.tasksMoved ?? 0)} moved`;
  return `${who} · ${how} · ${run.status === "SUCCESS" ? facts : run.status === "RUNNING" ? "Running" : run.error ?? "Failed"}`;
}

/* ── The section ────────────────────────────────────────────────────────── */

export function PropertyDevicesSettingsSection({ timeZone }: { timeZone: string }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<Message>(null);
  const prompt = useOwnPinPrompt(true);
  const requestRef = React.useRef<AbortController | null>(null);

  const reload = React.useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch("/api/admin/integrations/devices", { cache: "no-store", signal: controller.signal });
      const body = await readBody(response);
      if (controller.signal.aborted) return;
      if (!response.ok || !body.settings) throw new Error(errorText(body, "Could not load the device settings."));
      setLoad({ status: "ready", data: body as unknown as Loaded });
    } catch (error) {
      if (!controller.signal.aborted) setLoad((current) => (current.status === "ready" ? current : { status: "error", message: error instanceof Error ? error.message : "Could not load the device settings." }));
    }
  }, []);

  React.useEffect(() => {
    void reload();
    return () => requestRef.current?.abort();
  }, [reload]);

  async function send(key: string, url: string, init: RequestInit, success: string): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const body = await readBody(response);
      if (response.status === 423 || response.status === 403) prompt.noteRefusal();
      if (!response.ok) throw new Error(errorText(body, "That did not work."));
      if (success) setMessage({ tone: "success", text: success });
      return body;
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "That did not work." });
      return null;
    } finally {
      setBusy(null);
      void reload();
    }
  }

  const actions: ConnectionActions = {
    busy,
    pinReady: Boolean(prompt.credentials),
    syncNow: (provider) => {
      void send(`sync-${provider}`, "/api/admin/integrations/devices/sync", { method: "POST", body: JSON.stringify({ provider }) }, "").then((body) => {
        if (!body) return;
        setMessage(body.status === "SKIPPED" ? { tone: "info", text: String(body.reason ?? "Skipped.") } : { tone: "success", text: `${PROVIDER_LABEL[provider]} synced.` });
      });
    },
    disconnect: (provider) => {
      void send(`disconnect-${provider}`, "/api/admin/integrations/devices/disconnect", { method: "POST", body: JSON.stringify({ provider, security: prompt.credentials }) }, `${PROVIDER_LABEL[provider]} disconnected. Devices and readings already recorded stay.`).then(() => prompt.reset());
    },
  };

  async function connectRing(draft: RingDraft) {
    const body = await send("connect-RING", "/api/admin/integrations/devices/ring", {
      method: "POST",
      body: JSON.stringify({ email: draft.email, password: draft.password, ...(draft.prompt ? { twoFactorCode: draft.code } : {}), security: prompt.credentials }),
    }, "");
    if (!body) return null;
    if (body.needsCode) {
      setMessage({ tone: "info", text: String(body.prompt ?? "Enter the code Ring sent.") });
      return { prompt: String(body.prompt ?? "Enter the code Ring sent.") };
    }
    prompt.reset();
    setMessage({ tone: "success", text: "Ring connected. Link its locations to properties below, then press Sync now." });
    return { connected: true };
  }

  async function connectMinut(draft: MinutDraft) {
    const body = await send("connect-MINUT", "/api/admin/integrations/devices/minut", {
      method: "POST",
      body: JSON.stringify({ ...(draft.clientId ? { clientId: draft.clientId, clientSecret: draft.clientSecret } : {}), security: prompt.credentials }),
    }, "Minut connected. Link its homes to properties below, then press Sync now.");
    if (body) prompt.reset();
    return Boolean(body);
  }

  function link(locationId: string, propertyId: string | null) {
    void send(`link-${locationId}`, "/api/admin/integrations/devices/locations", { method: "PUT", body: JSON.stringify({ locationId, propertyId }) }, propertyId ? "Linked. The next sync adds its devices." : "Unlinked.");
  }

  if (load.status === "loading") return <p role="status" className={MUTED}>Loading device settings…</p>;
  if (load.status === "error") {
    return (
      <EAlert tone="danger" title="Could not load">
        {load.message} <EButton size="sm" variant="outline" onClick={() => void reload()}>Try again</EButton>
      </EAlert>
    );
  }
  const { data } = load;
  const ring = data.connections.find((connection) => connection.provider === "RING")!;
  const minut = data.connections.find((connection) => connection.provider === "MINUT")!;

  return (
    <div className="min-w-0 space-y-4">
      <ThresholdsCard saved={data.settings} onSaved={(settings) => setLoad({ status: "ready", data: { ...data, settings } })} />
      <ECard>
        <ECardHeader className="p-5 pb-0"><ECardTitle className="text-[1rem]">Confirm connection changes</ECardTitle></ECardHeader>
        <ECardBody className="space-y-2 p-5">
          <p className={MUTED}>Connecting, replacing the Minut credentials and disconnecting need your own PIN.</p>
          <OwnPinFields {...prompt.fieldProps} disabled={busy !== null} />
        </ECardBody>
      </ECard>
      {message ? <div aria-live="polite"><EAlert tone={message.tone}>{message.text}</EAlert></div> : null}
      <RingCard connection={ring} timeZone={timeZone} actions={actions} connect={connectRing} />
      <MinutCard connection={minut} timeZone={timeZone} actions={actions} connect={connectMinut} />
      <ECard>
        <ECardHeader className="p-5 pb-0"><ECardTitle className="text-[1rem]">Locations and properties</ECardTitle></ECardHeader>
        <ECardBody className="p-5">
          {data.locations.length === 0 ? (
            <p className={MUTED}>No Ring locations or Minut homes yet. Connect a provider and press Sync now; its locations appear here to link.</p>
          ) : (
            <ul>{data.locations.map((location) => <LocationRow key={location.id} location={location} properties={data.properties} busy={busy !== null} onLink={link} />)}</ul>
          )}
        </ECardBody>
      </ECard>
      <ECard>
        <ECardHeader className="p-5 pb-0"><ECardTitle className="text-[1rem]">Recent runs</ECardTitle></ECardHeader>
        <ECardBody className="p-5">
          {data.runs.length === 0 ? <p className={MUTED}>No runs yet. The device check runs every hour once the worker is running.</p> : (
            <ul className="space-y-1.5 text-[0.8125rem]">
              {data.runs.map((run) => (
                <li key={run.id} className="flex flex-wrap gap-x-3 break-words">
                  <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{formatWhen(run.createdAt, timeZone)}</span>
                  <span className={run.status === "ERROR" ? "text-[hsl(var(--e-danger))]" : undefined}>{runLine(run)}</span>
                </li>
              ))}
            </ul>
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
