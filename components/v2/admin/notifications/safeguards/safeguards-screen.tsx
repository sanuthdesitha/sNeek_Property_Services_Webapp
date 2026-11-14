"use client";

/**
 * Sending safeguards (Notifications › Sending safeguards).
 *
 * Reads: administrators and operations managers with the notifications pack.
 * Changes (emergency stop, pause / resume, limits): administrators only, never
 * while testing as someone else; the emergency stop and the limits need the
 * person's own PIN (the shared sensitive confirmation). Every change answers
 * with the fresh overview; a failed change keeps the draft and says why.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EAlert, EBadge, EButton, ECard, EEmptyState, EStatCard } from "@/components/v2/ui/primitives";
import { EConfirmDialog, type ConfirmResult } from "@/components/v2/ui/confirm-dialog";
import type { SafeguardIncidentView, SafeguardsResponse } from "@/lib/notifications/safeguards/overview-types";
import { SafeguardLimitsForm } from "./safeguards-limits-form";

const API = "/api/admin/notifications/safeguards";

type Pending = null | "stop" | "resume-all" | "pause" | `resume:${string}` | "limits";

type ConfirmState =
  | { kind: "emergency"; on: boolean }
  | { kind: "resume"; incident: SafeguardIncidentView }
  | { kind: "pause"; typeKey: string; typeName: string }
  | null;

const TRANSPORT_LABEL: Record<string, string> = { EMAIL: "Email", SMS: "SMS", WEB_PUSH: "Browser push", MOBILE_PUSH: "Phone push", PUSH: "Push" };

function when(value: string | null, timeZone: string): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatInTimeZone(date, timeZone, "d MMM, HH:mm") : "Unknown time";
}

function sum(rows: SafeguardsResponse["volumes"], pick: (row: SafeguardsResponse["volumes"][number]) => number, transports?: string[]): number {
  return rows.filter((row) => !transports || transports.includes(row.transport)).reduce((total, row) => total + pick(row), 0);
}

async function send(path: string, method: "POST" | "PATCH", body: unknown): Promise<{ ok: true; data: SafeguardsResponse } | { ok: false; message: string }> {
  try {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => null)) as (SafeguardsResponse & { error?: string }) | null;
    if (!response.ok || !data || data.error) return { ok: false, message: data?.error ?? `The server refused the change (${response.status}).` };
    return { ok: true, data };
  } catch {
    return { ok: false, message: "The server could not be reached. Nothing was changed." };
  }
}

function SectionCard({ id, title, description, children, action }: { id: string; title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <ECard className="min-w-0">
      <section aria-labelledby={id} className="space-y-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={id} className="text-[1rem] font-semibold">{title}</h2>
            {description ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{description}</p> : null}
          </div>
          {action}
        </div>
        {children}
      </section>
    </ECard>
  );
}

function IncidentRow({ incident, timeZone, canManage, pending, onResume }: { incident: SafeguardIncidentView; timeZone: string; canManage: boolean; pending: Pending; onResume: (incident: SafeguardIncidentView) => void }) {
  const scope = incident.scopeKind === "TYPE" ? "Type" : incident.scopeKind === "RECIPIENT" ? "Person" : incident.scopeKind === "SUBJECT" ? "Job or subject" : "Scheduled job";
  const source = incident.kind === "MANUAL_PAUSE" ? "Paused by an administrator" : incident.kind === "WORKER_FAILING" ? "Keeps failing" : "Paused automatically";
  return (
    <li className="flex flex-col gap-2 border-t border-[hsl(var(--e-border))] py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-medium [overflow-wrap:anywhere]">
          <EBadge tone={incident.status === "ACTIVE" ? (incident.pausesSending ? "danger" : "warning") : "neutral"} soft>{incident.status === "ACTIVE" ? (incident.pausesSending ? "Paused" : "Open") : "Resolved"}</EBadge>
          <span>{scope}: {incident.scopeLabel}</span>
        </p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
          {source} {when(incident.createdAt, timeZone)}
          {incident.kind === "BREAKER" ? ` · ${incident.attempts} ${TRANSPORT_LABEL[incident.transport ?? ""]?.toLowerCase() ?? "outbound"} attempts in ${incident.windowMinutes ?? "?"} min (limit ${incident.threshold ?? "?"})` : ""}
          {incident.kind === "WORKER_FAILING" ? ` · ${incident.attempts} failures in a row` : ""}
          {incident.recipients.length ? ` · ${incident.recipients.join(", ")}` : ""}
        </p>
        {incident.note ? <p className="text-[0.8125rem] [overflow-wrap:anywhere]">{incident.note}</p> : null}
        {incident.resolvedAt ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Resolved {when(incident.resolvedAt, timeZone)}{incident.resolutionNote ? `: ${incident.resolutionNote}` : ""}</p> : null}
      </div>
      {canManage && incident.status === "ACTIVE" && incident.pausesSending ? (
        <EButton variant="outline" size="sm" className="min-h-[44px] w-full sm:w-auto" disabled={pending !== null} onClick={() => onResume(incident)}>
          {pending === `resume:${incident.id}` ? "Resuming…" : "Resume"}
        </EButton>
      ) : null}
    </li>
  );
}

export function SafeguardsScreen({ initial, timeZone }: { initial: SafeguardsResponse; timeZone: string }) {
  const [data, setData] = React.useState<SafeguardsResponse>(initial);
  const [pending, setPending] = React.useState<Pending>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("");
  const [confirm, setConfirm] = React.useState<ConfirmState>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [pauseType, setPauseType] = React.useState("");
  const [loadState, setLoadState] = React.useState<"idle" | "loading" | "failed">("idle");
  const refreshAbort = React.useRef<AbortController | null>(null);
  const canManage = data.canManage;

  React.useEffect(() => () => refreshAbort.current?.abort(), []);

  async function refresh() {
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    setLoadState("loading");
    try {
      const response = await fetch(API, { cache: "no-store", signal: controller.signal });
      const next = (await response.json().catch(() => null)) as SafeguardsResponse | null;
      if (controller.signal.aborted) return;
      if (!response.ok || !next || !Array.isArray(next.volumes)) throw new Error("refresh failed");
      setData(next);
      setLoadState("idle");
    } catch {
      if (!controller.signal.aborted) setLoadState("failed");
    }
  }

  /** Returns null when the server confirmed the change, else its reason (kept for the dialog). */
  async function run(kind: Pending, path: string, method: "POST" | "PATCH", body: unknown, done: string): Promise<string | null> {
    setPending(kind);
    setError(null);
    const result = await send(path, method, body);
    setPending(null);
    if (!result.ok) return result.message;
    setData(result.data);
    setStatus(done);
    return null;
  }

  async function onConfirm(result: ConfirmResult) {
    if (!confirm) return;
    setConfirmError(null);
    let problem: string | null;
    if (confirm.kind === "emergency") {
      problem = await run("stop", `${API}/emergency-stop`, "POST", { on: confirm.on, reason: result.reason ?? null, security: result.credentials }, confirm.on ? "Emergency stop is on. Email, SMS and push are not being sent." : "Emergency stop is off. Sending has resumed.");
    } else if (confirm.kind === "resume") {
      problem = await run(`resume:${confirm.incident.id}`, `${API}/pauses`, "POST", { action: "resume", incidentId: confirm.incident.id }, `Resumed: ${confirm.incident.scopeLabel}.`);
    } else {
      problem = await run("pause", `${API}/pauses`, "POST", { action: "pause", typeKey: confirm.typeKey }, `Paused: ${confirm.typeName}.`);
      if (!problem) setPauseType("");
    }
    if (problem) setConfirmError(problem);
    else setConfirm(null);
  }

  async function saveLimits(limits: SafeguardsResponse["settings"]["limits"], credentials: ConfirmResult["credentials"]): Promise<string | null> {
    setPending("limits");
    setError(null);
    const result = await send(API, "PATCH", { limits, expectedUpdatedAt: data.settings.updatedAt, security: credentials });
    setPending(null);
    if (!result.ok) return result.message;
    setData(result.data);
    setStatus("Limits saved.");
    return null;
  }

  const stop = data.settings.emergencyStop;
  const totals = {
    email: sum(data.volumes, (row) => row.sent, ["EMAIL"]),
    sms: sum(data.volumes, (row) => row.sent, ["SMS"]),
    push: sum(data.volumes, (row) => row.sent, ["WEB_PUSH", "MOBILE_PUSH"]),
    notSent: sum(data.volumes, (row) => row.notSent),
    held: sum(data.volumes, (row) => row.held),
  };
  const selectedType = data.pausableTypes.find((type) => type.key === pauseType);
  const pausedTypeKeys = new Set(data.paused.filter((incident) => incident.scopeKind === "TYPE").map((incident) => incident.label));

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {error && !confirm ? <EAlert tone="danger" title="Not changed"><span role="alert">{error}</span></EAlert> : null}
      {!canManage && data.readOnlyReason ? <EAlert tone="info" title="View only">{data.readOnlyReason}</EAlert> : null}
      {loadState === "failed" ? <EAlert tone="warning" title="Could not refresh">The figures below are from {when(data.generatedAt, timeZone)}. <button type="button" className="underline" onClick={() => void refresh()}>Try again</button></EAlert> : null}

      <SectionCard
        id="emergency-stop-title"
        title="Emergency stop"
        description="One switch for every outbound email, SMS and push. The inbox keeps working; sign-in codes, password resets and invitations still go."
        action={canManage ? (
          <EButton variant={stop.on ? "outline" : "danger"} className="min-h-[44px] w-full sm:w-auto" disabled={pending !== null} onClick={() => { setConfirmError(null); setConfirm({ kind: "emergency", on: !stop.on }); }}>
            {pending === "stop" ? "Saving…" : stop.on ? "Resume sending" : "Stop all sending"}
          </EButton>
        ) : null}
      >
        {stop.on ? (
          <EAlert tone="danger" title="Emergency stop is ON">Nothing but security messages is leaving by email, SMS or push since {when(stop.changedAt, timeZone)}.{stop.reason ? ` Reason: ${stop.reason}` : ""}</EAlert>
        ) : (
          <p className="text-[0.875rem]"><EBadge tone="success" soft>Sending normally</EBadge>{stop.changedAt ? <span className="ml-2 text-[hsl(var(--e-muted-foreground))]">Last changed {when(stop.changedAt, timeZone)}</span> : null}</p>
        )}
      </SectionCard>

      <SectionCard id="paused-title" title={`Paused now (${data.paused.length})`} description="A pause stops email, SMS and push for its scope and keeps the inbox copy. It stays until an administrator resumes it; it never resumes on its own.">
        {data.paused.length === 0 ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Nothing is paused.</p>
        ) : (
          <ul aria-label="Paused" className="min-w-0">
            {data.paused.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} timeZone={timeZone} canManage={canManage} pending={pending} onResume={(item) => { setConfirmError(null); setConfirm({ kind: "resume", incident: item }); }} />
            ))}
          </ul>
        )}
        {canManage ? (
          <div className="flex flex-col gap-2 border-t border-[hsl(var(--e-border))] pt-3 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[0.8125rem] font-medium">
              Pause a notification type
              <select className="min-h-[44px] rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-[1rem] sm:text-[0.875rem]" value={pauseType} disabled={pending !== null} onChange={(event) => setPauseType(event.target.value)}>
                <option value="">Choose a type…</option>
                {data.pausableTypes.filter((type) => !pausedTypeKeys.has(type.name)).map((type) => <option key={type.key} value={type.key}>{type.name}</option>)}
              </select>
            </label>
            <EButton variant="outline" className="min-h-[44px] w-full sm:w-auto" disabled={!selectedType || pending !== null} onClick={() => selectedType && setConfirm({ kind: "pause", typeKey: selectedType.key, typeName: selectedType.name })}>
              {pending === "pause" ? "Pausing…" : "Pause"}
            </EButton>
          </div>
        ) : null}
      </SectionCard>

      <section aria-labelledby="today-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="today-title" className="text-[1rem] font-semibold">Today since {when(data.since, timeZone)}</h2>
          <EButton variant="ghost" size="sm" className="min-h-[44px]" disabled={loadState === "loading"} onClick={() => void refresh()}>{loadState === "loading" ? "Refreshing…" : "Refresh"}</EButton>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-5">
          <EStatCard label="Emails sent" value={totals.email} />
          <EStatCard label="SMS sent" value={totals.sms} />
          <EStatCard label="Push sent" value={totals.push} />
          <EStatCard label="Not sent" value={totals.notSent} deltaTone={totals.notSent ? "danger" : "neutral"} delta={totals.notSent ? "See reasons below" : undefined} />
          <EStatCard label="Held for morning" value={totals.held} />
        </div>
      </section>

      <SectionCard id="volumes-title" title="By type and transport" description="Sent counts are messages the provider was asked to take; sent is not delivered.">
        {data.volumes.length === 0 ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Nothing has been sent today.</p>
        ) : (
          <div role="region" aria-label="Volumes by type" tabIndex={0} className="max-h-[420px] min-w-0 overflow-auto">
            <ul className="min-w-0">
              <li aria-hidden className="hidden border-b border-[hsl(var(--e-border))] pb-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_4rem_4rem_4rem] sm:gap-2">
                <span>Type</span><span>Transport</span><span className="text-right">Sent</span><span className="text-right">Not sent</span><span className="text-right">Held</span>
              </li>
              {data.volumes.map((row) => (
                <li key={`${row.typeKey}-${row.transport}`} className="grid grid-cols-2 gap-x-2 gap-y-0.5 border-b border-[hsl(var(--e-border))] py-2 text-[0.875rem] sm:grid-cols-[minmax(0,1fr)_7rem_4rem_4rem_4rem]">
                  <span className="col-span-2 min-w-0 font-medium [overflow-wrap:anywhere] sm:col-span-1">{row.typeName}</span>
                  <span className="text-[hsl(var(--e-muted-foreground))]">{TRANSPORT_LABEL[row.transport] ?? row.transport}</span>
                  <span className="sm:text-right"><span className="sm:hidden">Sent </span>{row.sent}</span>
                  <span className="sm:text-right"><span className="sm:hidden">Not sent </span>{row.notSent}</span>
                  <span className="sm:text-right"><span className="sm:hidden">Held </span>{row.held}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <div className="grid min-w-0 gap-4 sm:gap-6 lg:grid-cols-2">
        <SectionCard id="not-sent-title" title="Not sent, and why" description="Never reported as delivered. The inbox copy remains where there is one.">
          {data.suppressedByReason.length ? (
            <ul aria-label="Reasons today" className="flex flex-wrap gap-2">
              {data.suppressedByReason.map((row) => <li key={row.reason}><EBadge tone="warning" soft>{row.count} · {row.label}</EBadge></li>)}
            </ul>
          ) : <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Nothing was held back today.</p>}
          {data.recentNotSent.length ? (
            <div role="region" aria-label="Recent messages not sent" tabIndex={0} className="max-h-[360px] min-w-0 overflow-auto">
              <ul className="min-w-0">
                {data.recentNotSent.map((row) => (
                  <li key={row.id} className="border-t border-[hsl(var(--e-border))] py-2 text-[0.8125rem] first:border-t-0">
                    <p className="font-medium [overflow-wrap:anywhere]">{row.typeName} · {TRANSPORT_LABEL[row.transport] ?? row.transport} · {row.recipient}</p>
                    <p className="text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{when(row.createdAt, timeZone)} · {row.held ? "Held: " : "Not sent: "}{row.label}{row.subject ? ` · "${row.subject}"` : ""}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard id="top-title" title="Most messages today" description="People receiving the most, per transport.">
          {data.topRecipients.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Nobody has been sent anything today.</p>
          ) : (
            <ol className="min-w-0 space-y-1">
              {data.topRecipients.map((row, index) => (
                <li key={`${row.recipient}-${row.transport}-${index}`} className="flex items-center justify-between gap-2 text-[0.875rem]">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{row.recipient} <span className="text-[hsl(var(--e-muted-foreground))]">· {TRANSPORT_LABEL[row.transport] ?? row.transport}</span></span>
                  <span className="e-numeral shrink-0">{row.sent}</span>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      <SafeguardLimitsForm settings={data.settings} canManage={canManage} saving={pending === "limits"} disabled={pending !== null && pending !== "limits"} onSave={saveLimits} />

      <SectionCard id="incidents-title" title="Recent incidents" description="Automatic pauses, administrators' pauses and scheduled jobs that kept failing.">
        {data.incidents.length === 0 ? (
          <EEmptyState title="No incidents" description="Nothing has tripped a safeguard." className="py-8" />
        ) : (
          <ul aria-label="Recent incidents" className="min-w-0">
            {data.incidents.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} timeZone={timeZone} canManage={canManage} pending={pending} onResume={(item) => { setConfirmError(null); setConfirm({ kind: "resume", incident: item }); }} />
            ))}
          </ul>
        )}
      </SectionCard>

      <EConfirmDialog
        open={confirm !== null}
        onClose={() => { if (pending === null) setConfirm(null); }}
        tier={confirm?.kind === "emergency" ? "sensitive" : "ordinary"}
        title={confirm?.kind === "emergency" ? (confirm.on ? "Stop all outbound sending?" : "Resume sending?") : confirm?.kind === "resume" ? `Resume ${confirm.incident.scopeLabel}?` : `Pause ${confirm?.kind === "pause" ? confirm.typeName : ""}?`}
        description={confirm?.kind === "emergency"
          ? (confirm.on ? "Every email, SMS and push stops except sign-in codes, password resets and invitations. Inbox notices continue. Messages are recorded as not sent." : "Email, SMS and push start again. Messages stopped meanwhile are not sent later.")
          : confirm?.kind === "resume" ? "Email, SMS and push for it start again with the next message. Messages stopped meanwhile are not sent later." : "Email, SMS and push for this type stop until you resume it. Inbox notices continue."}
        confirmLabel={confirm?.kind === "emergency" ? (confirm.on ? "Stop sending" : "Resume sending") : confirm?.kind === "resume" ? "Resume" : "Pause"}
        busy={pending !== null}
        error={confirmError}
        onConfirm={onConfirm}
      />
    </div>
  );
}
