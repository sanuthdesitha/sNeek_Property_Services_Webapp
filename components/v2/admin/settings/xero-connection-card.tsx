"use client";

import { Link2, RefreshCw, Unlink } from "lucide-react";
import { EAlert, EBadge, EButton } from "@/components/v2/ui/primitives";
import type { XeroConnectionState, XeroStatus } from "@/lib/xero/connection-status";

/** What /api/xero/status returns: the stored status plus the organisation timezone. */
export type XeroStatusView = (Partial<XeroStatus> & { connected: boolean; timezone?: string }) | null;

type BadgeTone = "success" | "warning" | "danger" | "neutral";

const STATE_BADGE: Record<XeroConnectionState, { tone: BadgeTone; label: string }> = {
  connected: { tone: "success", label: "Connected" },
  attention: { tone: "warning", label: "Connected · renewal retrying" },
  "reconnect-once": { tone: "warning", label: "Reconnect once" },
  "needs-reconnect": { tone: "danger", label: "Needs reconnect" },
};

/** A stored instant in the organisation timezone; "Not recorded" when absent. */
export function formatXeroTime(iso: string | null | undefined, timezone: string | undefined): string {
  if (!iso) return "Not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  try {
    return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: timezone || "Australia/Sydney" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
}

function stateOf(view: XeroStatusView): XeroConnectionState | null {
  if (!view || !view.state) return null;
  return view.state;
}

type CardProps = {
  view: XeroStatusView;
  connecting: boolean;
  disconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

/**
 * Settings › Xero connection: state, organisation, connected since, last and
 * next renewal, the daily keep-alive and the 60-day limit, plus "needs
 * reconnect" with its reason and a Reconnect button.
 */
export function XeroConnectionCard({ view, connecting, disconnecting, onConnect, onDisconnect }: CardProps) {
  const state = stateOf(view);
  const timezone = view?.timezone;
  const badge = state ? STATE_BADGE[state] : { tone: "neutral" as const, label: "Not connected" };
  const mustReconnect = state === "needs-reconnect" || state === "reconnect-once";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <EBadge tone={badge.tone} soft>{badge.label}</EBadge>
          {state && view?.tenantName ? (
            <span className="min-w-0 break-words text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Organisation · {view.tenantName}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!state ? (
            <EButton variant="gold" onClick={onConnect} disabled={connecting}>
              <Link2 className="h-4 w-4" /> {connecting ? "Connecting…" : "Connect to Xero"}
            </EButton>
          ) : (
            <>
              <EButton variant={mustReconnect ? "gold" : "outline"} onClick={onConnect} disabled={connecting || disconnecting}>
                <RefreshCw className="h-4 w-4" /> {connecting ? "Opening Xero…" : "Reconnect"}
              </EButton>
              <EButton variant="outline" onClick={onDisconnect} disabled={disconnecting || connecting}>
                <Unlink className="h-4 w-4" /> {disconnecting ? "Disconnecting…" : "Disconnect"}
              </EButton>
            </>
          )}
        </div>
      </div>

      {state === "needs-reconnect" ? (
        <EAlert tone="danger" title="Xero needs reconnecting" className="mt-4">
          <p>{view?.reason ?? "Xero needs reconnecting."}</p>
          <p className="mt-1">Invoices and bills cannot reach Xero until it is reconnected. Pushes that failed can be retried afterwards from the invoice lists.</p>
          {view?.needsReconnectAt ? <p className="mt-1 text-[0.75rem]">Since {formatXeroTime(view.needsReconnectAt, timezone)}</p> : null}
        </EAlert>
      ) : null}
      {state === "reconnect-once" ? (
        <EAlert tone="warning" title="Reconnect Xero once to keep it connected" className="mt-4">
          <p>{view?.reason}</p>
        </EAlert>
      ) : null}
      {state === "attention" ? (
        <EAlert tone="warning" title="The last renewal failed" className="mt-4">
          <p>{view?.reason}</p>
        </EAlert>
      ) : null}

      {state ? (
        <dl className="mt-5 grid gap-x-6 gap-y-3 text-[0.8125rem] sm:grid-cols-2">
          <XeroFact label="Connected since" value={formatXeroTime(view?.connectedAt, timezone)} />
          <XeroFact label="Last refreshed" value={view?.lastRefreshedAt ? formatXeroTime(view.lastRefreshedAt, timezone) : "Not yet (renews when first needed)"} />
          <XeroFact
            label="Next refresh"
            value={view?.nextRefreshAt ? `${formatXeroTime(view.nextRefreshAt, timezone)} or the next Xero call after it` : "Cannot renew until reconnected"}
          />
          <XeroFact label="Keep-alive" value={view?.keepAliveSchedule ?? "Daily"} />
          {view?.renewBy ? <XeroFact label="Must renew by (60 days unused)" value={formatXeroTime(view.renewBy, timezone)} /> : null}
          {view?.lastRefreshAttemptAt ? <XeroFact label="Last renewal attempt" value={formatXeroTime(view.lastRefreshAttemptAt, timezone)} /> : null}
        </dl>
      ) : null}
    </div>
  );
}

function XeroFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{label}</dt>
      <dd className="break-words text-[hsl(var(--e-text-secondary))]">{value}</dd>
    </div>
  );
}
