"use client";

import * as React from "react";
import { BellRing, RefreshCcw } from "lucide-react";
import { EPill } from "@/components/v2/ui/pill";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { CommsManualDispatch } from "@/components/v2/admin/comms/manual-dispatch";
import { NotificationToolsSection } from "@/components/v2/admin/settings/notification-tools-section";
import type { EstateToast } from "@/components/v2/admin/comms/toast";
import { TRANSPORT_LABEL } from "@/lib/notifications/catalog-types";
import type { NotificationHealth } from "@/lib/notifications/health-types";
import { useNotificationRead } from "./use-notification-read";
import { formatDeliveryTime } from "./delivery-format";
import { LazyDisclosure } from "./lazy-disclosure";

function parseHealth(body: unknown): NotificationHealth {
  const value = body as Partial<NotificationHealth> | null;
  if (!value || !Array.isArray(value.transports) || !Array.isArray(value.banners)) throw new Error("bad health");
  return value as NotificationHealth;
}

function age(iso: string | null): string {
  if (!iso) return "none waiting";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

const WORKER_TONE = { ACTIVE: "ok", STALE: "warn", MISSING: "bad" } as const;

export function HealthTab({ isAdmin, onToast }: { isAdmin: boolean; onToast: (toast: EstateToast) => void }) {
  const read = useNotificationRead("/api/admin/notifications/health", parseHealth, "Notification health is unavailable.");
  const [testingPush, setTestingPush] = React.useState(false);
  const health = read.data;

  async function sendTestPush() {
    setTestingPush(true);
    const response = await fetch("/api/push/test", { method: "POST" }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { error?: string; devices?: number } | undefined;
    setTestingPush(false);
    if (!response?.ok) onToast({ title: "Test push not sent", description: body?.error ?? "Could not send the test push.", tone: "danger" });
    else onToast({ title: "Test push requested", description: `Requested for ${body?.devices ?? 0} of your device(s); delivery is not confirmed.`, tone: "success" });
  }

  return (
    <section aria-labelledby="health-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="health-heading" className="text-lg font-semibold">Health</h2>
          <p className="text-sm text-[hsl(var(--e-muted-foreground))]">Credentials are reported as present or missing; their values are never shown.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <EButton variant="outline" size="sm" onClick={read.reload} disabled={read.loading}><RefreshCcw className="h-4 w-4" />Refresh</EButton>
          <EButton variant="outline" size="sm" onClick={() => void sendTestPush()} disabled={testingPush}><BellRing className="h-4 w-4" />{testingPush ? "Sending…" : "Test push to my devices"}</EButton>
        </div>
      </div>

      {read.loading && !health ? <p role="status">Checking transports…</p> : null}
      {read.error ? <EAlert tone={health ? "warning" : "danger"} title={health ? "Showing the last check" : "Health check failed"}>{read.error} <button type="button" className="underline" onClick={read.reload}>Retry</button></EAlert> : null}

      {health ? (
        <>
          {health.banners.map((banner) => <EAlert key={banner.key} tone="warning" title="Direct path in use">{banner.message}</EAlert>)}
          {health.xero?.message ? (
            <EAlert tone={health.xero.signIn === "lapsed" ? "danger" : "warning"} title={health.xero.message}>
              Xero payment checks and the receipts they send depend on it. <a className="underline" href="/v2/admin/settings?tab=xero">Open Xero settings</a>
            </EAlert>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {health.transports.map((transport) => (
              <article key={transport.transport} className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4 text-sm">
                <h3 className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                  {TRANSPORT_LABEL[transport.transport]}
                  <EPill tone={transport.configured === null ? "neutral" : transport.configured ? "ok" : "bad"}>{transport.configured === null ? "Switched off" : transport.configured ? "Configured" : "Not configured"}</EPill>
                </h3>
                <p className="text-xs">{transport.configuredNote}</p>
                <p className="text-xs">{transport.enabledNote}</p>
                <p className="text-xs">Queued: <span className="e-tnum">{transport.queued}</span> · oldest waiting: {age(transport.oldestQueuedAt)}</p>
                <p className="text-xs">Failures in the last 24 h: <span className="e-tnum">{transport.failures24h}</span></p>
              </article>
            ))}
          </div>
          <article className="space-y-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4 text-sm">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">Worker <EPill tone={WORKER_TONE[health.worker.status]}>{health.worker.status.toLowerCase()}</EPill></h3>
            <p className="text-xs">Last heartbeat: {health.worker.lastSeenAt ? formatDeliveryTime(health.worker.lastSeenAt) : "never"}. Phone push dispatcher: {health.worker.mobileDispatcherActive ? "running" : "not running"}. Pipeline dispatcher: {health.worker.intentDispatcherActive === null ? "unknown" : health.worker.intentDispatcherActive ? "running" : "not registered"}.</p>
            <p className="text-xs">Master switches: email {health.masterSwitches.email ? "on" : "OFF"}, SMS {health.masterSwitches.sms ? "on" : "OFF"}, push {health.masterSwitches.push ? "on" : "OFF"}, automatic email {health.masterSwitches.automaticEmail ? "on" : "OFF"}.</p>
            <p className="text-xs">Pipeline intents by status: {Object.entries(health.intentStatusCounts).map(([status, count]) => `${status.toLowerCase()} ${count}`).join(", ") || "none"}.</p>
          </article>
          <div className="overflow-x-auto rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]" role="region" aria-label="Environment switches" tabIndex={0}>
            <table className="w-full min-w-[40rem] text-left text-xs">
              <caption className="p-3 text-left text-sm font-semibold">Environment switches in effect</caption>
              <thead><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Value</th><th className="px-3 py-2">Effect</th></tr></thead>
              <tbody>{health.envFlags.map((flag) => <tr key={flag.name} className="border-t border-[hsl(var(--e-border))]"><td className="px-3 py-2"><code>{flag.name}</code></td><td className="px-3 py-2"><code>{flag.value}</code></td><td className="px-3 py-2">{flag.effect}</td></tr>)}</tbody>
            </table>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs text-[hsl(var(--e-muted-foreground))]">{health.unknowns.map((item) => <li key={item}>{item}</li>)}</ul>
        </>
      ) : null}

      <LazyDisclosure summary="Run scheduled notifications now (reminders, tomorrow prep, stock alerts, summary) and resend failed reminders">
        <CommsManualDispatch onToast={onToast} />
      </LazyDisclosure>
      <LazyDisclosure summary="Provider tests (send a test email or SMS to an address)">
        <NotificationToolsSection isAdmin={isAdmin} />
      </LazyDisclosure>
    </section>
  );
}
