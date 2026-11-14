/**
 * The Xero connection status shown in Settings › Xero, the Finance header and
 * the notifications Health tab. Pure (no server imports), so client
 * components can import its types.
 *
 * Never reports "connected" for an unknown state: a connection whose last
 * renewal failed is "attention", one that cannot renew is "reconnect-once" or
 * "needs-reconnect".
 */

/** Renew the access token this long before it expires (mirrors token-service). */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** Xero: an unused refresh token expires after 60 days. */
export const XERO_REFRESH_TOKEN_IDLE_DAYS = 60;
/** The daily keep-alive (workers/boss.ts `xero-token-keepalive`). */
export const XERO_KEEPALIVE_CRON = "47 3 * * *";
export const XERO_KEEPALIVE_LABEL = "Daily at 3:47 am (Australia/Sydney)";

export type XeroConnectionState = "connected" | "attention" | "reconnect-once" | "needs-reconnect";
export type XeroSignIn = "ok" | "no-refresh-token" | "lapsed";

export type XeroStatus = {
  /** False when Xero cannot be used without someone reconnecting. */
  connected: boolean;
  state: XeroConnectionState;
  tenantName: string;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  lastRefreshAttemptAt: string | null;
  accessTokenExpiresAt: string;
  /** After this time the next Xero call renews the access token (null when it cannot renew). */
  nextRefreshAt: string | null;
  keepAliveSchedule: string;
  /** The refresh token expires if not used by this time (60 days after its last use). */
  renewBy: string | null;
  hasRefreshToken: boolean;
  /** Why it needs reconnecting, or why it needs attention. */
  reason: string | null;
  reasonCode: string | null;
  needsReconnectAt: string | null;
  lastRefreshError: string | null;
  lastTenantCheckAt: string | null;
  /** Kept for older screens: ok, no-refresh-token or lapsed. */
  signIn: XeroSignIn;
  /** Kept for older screens: the last successful renewal. */
  lastSyncAt?: string;
};

export type XeroStatusRow = {
  tenantName: string;
  refreshToken: string;
  expiresAt: Date;
  status?: string | null;
  statusReason?: string | null;
  statusReasonCode?: string | null;
  needsReconnectAt?: Date | null;
  connectedAt?: Date | null;
  createdAt?: Date | null;
  lastRefreshedAt?: Date | null;
  lastRefreshAttemptAt?: Date | null;
  lastRefreshError?: string | null;
  lastTenantCheckAt?: Date | null;
};

const NO_REFRESH_TOKEN_REASON =
  "This connection was made without offline access, so Xero issued no refresh token and it stops working when the access token expires (about 30 minutes). Reconnect Xero once to keep it connected.";

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export function xeroConnectionState(row: XeroStatusRow): XeroConnectionState {
  if (row.status === "NEEDS_RECONNECT") return "needs-reconnect";
  if (!row.refreshToken) return "reconnect-once";
  if (row.lastRefreshError) return "attention";
  return "connected";
}

/** Pure: the sign-in state of a stored connection at `now` (older screens). */
export function xeroSignInState(row: Pick<XeroStatusRow, "refreshToken" | "expiresAt" | "status">, now: Date = new Date()): XeroSignIn {
  if (row.status === "NEEDS_RECONNECT") return "lapsed";
  if (!row.refreshToken) return row.expiresAt.getTime() <= now.getTime() ? "lapsed" : "no-refresh-token";
  return "ok";
}

/** Plain words for a sign-in state, or null when nothing needs saying. */
export function xeroSignInMessage(signIn: XeroSignIn | undefined): string | null {
  if (signIn === "lapsed") return "Xero needs reconnecting";
  if (signIn === "no-refresh-token") return "Reconnect Xero once to keep it connected";
  return null;
}

export function buildXeroStatus(row: XeroStatusRow, now: Date = new Date()): XeroStatus {
  const state = xeroConnectionState(row);
  const lastUse = row.lastRefreshedAt ?? row.connectedAt ?? row.createdAt ?? null;
  const renewable = state === "connected" || state === "attention";
  const reason =
    state === "needs-reconnect" ? row.statusReason ?? "Xero needs reconnecting."
      : state === "reconnect-once" ? NO_REFRESH_TOKEN_REASON
        : state === "attention" ? `The last sign-in renewal failed: ${row.lastRefreshError}. It is retried automatically.`
          : null;
  return {
    connected: state !== "needs-reconnect" && !(state === "reconnect-once" && row.expiresAt.getTime() <= now.getTime()),
    state,
    tenantName: row.tenantName,
    connectedAt: iso(row.connectedAt ?? row.createdAt),
    lastRefreshedAt: iso(row.lastRefreshedAt),
    lastRefreshAttemptAt: iso(row.lastRefreshAttemptAt),
    accessTokenExpiresAt: row.expiresAt.toISOString(),
    nextRefreshAt: renewable ? new Date(row.expiresAt.getTime() - REFRESH_MARGIN_MS).toISOString() : null,
    keepAliveSchedule: XERO_KEEPALIVE_LABEL,
    renewBy: renewable && lastUse ? new Date(lastUse.getTime() + XERO_REFRESH_TOKEN_IDLE_DAYS * 86_400_000).toISOString() : null,
    hasRefreshToken: Boolean(row.refreshToken),
    reason,
    reasonCode: state === "needs-reconnect" ? row.statusReasonCode ?? null : state === "reconnect-once" ? "NO_REFRESH_TOKEN" : null,
    needsReconnectAt: iso(row.needsReconnectAt),
    lastRefreshError: row.lastRefreshError ?? null,
    lastTenantCheckAt: iso(row.lastTenantCheckAt),
    signIn: xeroSignInState(row, now),
    ...(row.lastRefreshedAt ? { lastSyncAt: row.lastRefreshedAt.toISOString() } : {}),
  };
}
