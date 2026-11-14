/**
 * The one Xero token service (2026-11-15). Every Xero call gets its access
 * token here.
 *
 * Xero facts this relies on (developer.xero.com/faq/oauth2, checked
 * 2026-11-14): access tokens last 30 minutes; a refresh token is issued only
 * with the offline_access scope; each refresh returns a new refresh token that
 * replaces the old one (the old one may be retried for a 30-minute grace
 * period if the response was lost); an unused refresh token expires after 60
 * days.
 *
 * Rules:
 * - The access token is renewed when it is within REFRESH_MARGIN_MS of expiry,
 *   when Xero answered 401 to it (`rejectedVersion`), or when forced (the
 *   daily keep-alive).
 * - Single flight across processes (web replicas and the worker): a renewal
 *   takes a lease on the row with a compare-and-set on `tokenVersion`; others
 *   keep using a still-valid token or wait for the new version. The new access
 *   token, refresh token and expiry are written together, encrypted, with the
 *   version incremented, BEFORE the new token is used.
 * - Transient failures (network, timeout, 5xx, 429) are retried with backoff
 *   and leave the connection CONNECTED (recorded in lastRefreshError).
 *   Terminal failures (invalid_grant, the app's credentials refused, no refresh
 *   token, the organisation disconnected) set NEEDS_RECONNECT with a reason,
 *   keep the row for audit and stop renewing until someone reconnects. An
 *   inbox notice goes to administrators once per outage.
 * - Tokens are never logged or put in a returned reason.
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { getXeroCredentials, type XeroAppCredentials } from "./credentials";

export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
/** Renew this long before the access token expires. */
export const REFRESH_MARGIN_MS = 5 * 60_000;
/** How long one renewal may hold the row; longer than every attempt plus backoff. */
export const REFRESH_LEASE_MS = 90_000;
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 4_000];
const MAX_RETRY_AFTER_MS = 20_000;
const LEASE_POLL_MS = 250;
/** A waiting caller may keep using the current token while it has this much life left. */
const USABLE_WHILE_WAITING_MS = 30_000;

export type XeroConnectionStatusValue = "CONNECTED" | "NEEDS_RECONNECT";
export type XeroReconnectReasonCode = "NO_REFRESH_TOKEN" | "REFRESH_REJECTED" | "APP_CREDENTIALS_REJECTED" | "TENANT_REMOVED";
export type XeroTokenFailureKind = "not-connected" | "needs-reconnect" | "transient" | "configuration";

export type XeroAccessToken = {
  connectionId: string;
  tenantId: string;
  tenantName: string;
  accessToken: string;
  tokenVersion: number;
  expiresAt: Date;
};

export type XeroTokenFailure = { ok: false; kind: XeroTokenFailureKind; reason: string; code?: XeroReconnectReasonCode };
export type XeroTokenOutcome = { ok: true; token: XeroAccessToken; refreshed: boolean } | XeroTokenFailure;

export type XeroTokenRequest = {
  /** Renew even though the access token is still fresh (daily keep-alive). */
  force?: boolean;
  /** The version whose access token Xero answered 401 to: renew unless a newer one exists. */
  rejectedVersion?: number;
};

export type XeroReconnectNoticeInput = { connectionId: string; tenantName: string; reason: string; needsReconnectAt: Date };

type ConnectionTable = Pick<typeof db, "xeroConnection">;

export type XeroTokenDeps = {
  db: ConnectionTable;
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  credentials: () => Promise<XeroAppCredentials>;
  notify: (input: XeroReconnectNoticeInput) => Promise<void>;
};

type ConnectionRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenVersion: number;
  status: string;
  statusReason: string | null;
  statusReasonCode: string | null;
};

type TokenGrant = { accessToken: string; refreshToken: string | null; expiresInSeconds: number };
type ExchangeResult =
  | { kind: "ok"; grant: TokenGrant }
  | { kind: "rejected"; code: XeroReconnectReasonCode; reason: string }
  | { kind: "transient"; reason: string };

const CONNECTION_SELECT = {
  id: true, tenantId: true, tenantName: true, accessToken: true, refreshToken: true, expiresAt: true,
  tokenVersion: true, status: true, statusReason: true, statusReasonCode: true,
} as const;

async function defaultNotify(input: XeroReconnectNoticeInput): Promise<void> {
  // Imported lazily: the notification pipeline is not needed on the hot path.
  const { sendXeroReconnectNotice } = await import("./reconnect-notice");
  await sendXeroReconnectNotice(input);
}

function resolveDeps(partial: Partial<XeroTokenDeps>): XeroTokenDeps {
  return {
    db: partial.db ?? db,
    fetch: partial.fetch ?? ((input, init) => fetch(input, init)),
    now: partial.now ?? (() => new Date()),
    sleep: partial.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    credentials: partial.credentials ?? getXeroCredentials,
    notify: partial.notify ?? defaultNotify,
  };
}

/** Plain words for a reconnect reason code. */
export function reconnectReasonText(code: XeroReconnectReasonCode, detail?: string): string {
  switch (code) {
    case "NO_REFRESH_TOKEN":
      return "This connection was made without offline access, so Xero issued no refresh token. Reconnect Xero once to keep it connected.";
    case "REFRESH_REJECTED":
      return `Xero refused to renew the sign-in${detail ? ` (${detail})` : ""}: it was disconnected or revoked in Xero, or went unused for 60 days. Reconnect Xero.`;
    case "APP_CREDENTIALS_REJECTED":
      return `Xero refused this app's Client ID or Secret${detail ? ` (${detail})` : ""}. Check them in Settings → Integrations, then reconnect Xero.`;
    case "TENANT_REMOVED":
      return "This Xero organisation is no longer connected to the app (it was disconnected in Xero). Reconnect Xero.";
  }
}

/** One line, no bearer tokens or long opaque strings, bounded. */
export function safeReason(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  const redacted = oneLine
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9._~+/=-]{40,}\b/g, "[redacted]");
  return redacted.length > 300 ? `${redacted.slice(0, 299)}…` : redacted;
}

/** Whether a secret can be stored encrypted right now (ENCRYPTION_KEY present). */
export function xeroTokenEncryptionAvailable(): boolean {
  try {
    return Boolean(encryptSecret("probe"));
  } catch {
    return false;
  }
}

/** Encrypt a token for storage; an empty token stays empty (no refresh token issued). */
export function sealXeroToken(token: string | null | undefined): string {
  return token ? encryptSecret(token) ?? "" : "";
}

async function readActiveConnection(deps: XeroTokenDeps): Promise<ConnectionRow | null> {
  const row = await deps.db.xeroConnection.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: CONNECTION_SELECT,
  });
  return (row as ConnectionRow | null) ?? null;
}

function failure(kind: XeroTokenFailureKind, reason: string, code?: XeroReconnectReasonCode): XeroTokenFailure {
  return { ok: false, kind, reason, ...(code ? { code } : {}) };
}

function needsReconnectFailure(conn: Pick<ConnectionRow, "statusReason" | "statusReasonCode">): XeroTokenFailure {
  const code = (conn.statusReasonCode ?? undefined) as XeroReconnectReasonCode | undefined;
  return failure("needs-reconnect", conn.statusReason ?? (code ? reconnectReasonText(code) : "Xero needs reconnecting."), code);
}

function currentToken(conn: ConnectionRow, refreshed: boolean): XeroTokenOutcome {
  const accessToken = decryptSecret(conn.accessToken);
  if (!accessToken) {
    return failure("configuration", "The stored Xero sign-in could not be read (ENCRYPTION_KEY missing or changed). Reconnect Xero.");
  }
  return {
    ok: true,
    refreshed,
    token: {
      connectionId: conn.id, tenantId: conn.tenantId, tenantName: conn.tenantName,
      accessToken, tokenVersion: conn.tokenVersion, expiresAt: conn.expiresAt,
    },
  };
}

function refreshNeeded(conn: ConnectionRow, now: Date, request: XeroTokenRequest): boolean {
  const nearExpiry = conn.expiresAt.getTime() - now.getTime() <= REFRESH_MARGIN_MS;
  if (request.rejectedVersion !== undefined) return conn.tokenVersion === request.rejectedVersion || nearExpiry;
  return Boolean(request.force) || nearExpiry;
}

function usableWhileWaiting(conn: ConnectionRow, now: Date, request: XeroTokenRequest): boolean {
  if (request.force || request.rejectedVersion === conn.tokenVersion) return false;
  return conn.expiresAt.getTime() - now.getTime() > USABLE_WHILE_WAITING_MS;
}

async function acquireLease(conn: ConnectionRow, leaseId: string, deps: XeroTokenDeps): Promise<boolean> {
  const now = deps.now();
  const result = await deps.db.xeroConnection.updateMany({
    where: {
      id: conn.id,
      tokenVersion: conn.tokenVersion,
      status: "CONNECTED",
      OR: [{ refreshLockUntil: null }, { refreshLockUntil: { lt: now } }],
    },
    data: { refreshLockId: leaseId, refreshLockUntil: new Date(now.getTime() + REFRESH_LEASE_MS), lastRefreshAttemptAt: now },
  });
  return result.count === 1;
}

async function releaseLease(connectionId: string, leaseId: string, deps: XeroTokenDeps, lastRefreshError?: string): Promise<void> {
  await deps.db.xeroConnection
    .updateMany({
      where: { id: connectionId, refreshLockId: leaseId },
      data: { refreshLockId: null, refreshLockUntil: null, ...(lastRefreshError ? { lastRefreshError } : {}) },
    })
    .catch((error: unknown) => logger.warn({ error: errorText(error), connectionId }, "[xero] could not release the refresh lease; it expires on its own"));
}

function errorText(error: unknown): string {
  return safeReason(error instanceof Error ? error.message : String(error));
}

function retryAfterMs(header: string | null | undefined): number | null {
  if (!header || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim()) * 1000;
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseGrant(body: Record<string, unknown> | null): TokenGrant | null {
  if (!body) return null;
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : Number(body.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  const refreshToken = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null;
  return { accessToken, refreshToken, expiresInSeconds: expiresIn };
}

function classifyRefusal(status: number, body: Record<string, unknown> | null): ExchangeResult | null {
  const error = typeof body?.error === "string" ? body.error : "";
  const description = typeof body?.error_description === "string" ? safeReason(body.error_description) : "";
  const detail = [error, description].filter(Boolean).join(": ");
  if (error === "invalid_grant") return { kind: "rejected", code: "REFRESH_REJECTED", reason: reconnectReasonText("REFRESH_REJECTED", detail) };
  if (error === "invalid_client" || error === "unauthorized_client") {
    return { kind: "rejected", code: "APP_CREDENTIALS_REJECTED", reason: reconnectReasonText("APP_CREDENTIALS_REJECTED", detail) };
  }
  if (status === 429 || status >= 500) return null; // retryable
  return { kind: "transient", reason: `Xero did not renew the sign-in (${status}${detail ? `, ${detail}` : ""}). It will be tried again.` };
}

/** POST the refresh grant, retrying transient failures with backoff. */
async function exchangeRefreshToken(refreshToken: string, creds: XeroAppCredentials, deps: XeroTokenDeps): Promise<ExchangeResult> {
  let lastReason = "Xero could not be reached to renew the sign-in.";
  for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt += 1) {
    let waitMs = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    try {
      const res = await deps.fetch(XERO_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
        }),
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      });
      const body = await readJson(res);
      if (res.ok) {
        const grant = parseGrant(body);
        if (grant) return { kind: "ok", grant };
        // The response was lost to us; the old refresh token stays valid for
        // Xero's grace period, so this is retryable.
        lastReason = "Xero's renewal response could not be read.";
      } else {
        const refusal = classifyRefusal(res.status, body);
        if (refusal) return refusal;
        lastReason = res.status === 429 ? "Xero's rate limit was reached while renewing the sign-in." : `Xero was unavailable while renewing the sign-in (${res.status}).`;
        const retryAfter = res.status === 429 ? retryAfterMs(res.headers?.get?.("Retry-After")) : null;
        if (retryAfter !== null) waitMs = retryAfter;
      }
    } catch (error) {
      lastReason = `Xero could not be reached to renew the sign-in: ${errorText(error)}`;
    }
    if (attempt < REFRESH_ATTEMPTS && waitMs <= MAX_RETRY_AFTER_MS) await deps.sleep(waitMs);
    else if (attempt < REFRESH_ATTEMPTS) break;
  }
  return { kind: "transient", reason: lastReason };
}

/**
 * Persist a renewal: new tokens (encrypted), expiry and version together,
 * only while this lease still holds the version that was renewed.
 */
async function persistGrant(conn: ConnectionRow, leaseId: string, grant: TokenGrant, refreshTokenUsed: string, deps: XeroTokenDeps): Promise<XeroTokenOutcome> {
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + grant.expiresInSeconds * 1000);
  const data = {
    accessToken: sealXeroToken(grant.accessToken),
    // Xero always returns a rotated refresh token; if one ever does not, the
    // token just used is kept rather than losing the connection.
    refreshToken: sealXeroToken(grant.refreshToken ?? refreshTokenUsed),
    expiresAt,
    tokenVersion: { increment: 1 },
    lastRefreshedAt: now,
    lastSyncAt: now,
    lastRefreshError: null,
    lastSyncError: null,
    refreshLockId: null,
    refreshLockUntil: null,
  };
  let written = await deps.db.xeroConnection.updateMany({ where: { id: conn.id, tokenVersion: conn.tokenVersion, refreshLockId: leaseId }, data });
  if (written.count === 0) {
    // The lease ran out, but nobody else finished a renewal of this version.
    written = await deps.db.xeroConnection.updateMany({ where: { id: conn.id, tokenVersion: conn.tokenVersion, status: "CONNECTED" }, data });
  }
  if (written.count === 0) {
    logger.warn({ connectionId: conn.id }, "[xero] another process stored a renewal first; using the stored one");
    const latest = await readActiveConnection(deps);
    if (!latest) return failure("not-connected", "No active Xero connection");
    if (latest.status === "NEEDS_RECONNECT") return needsReconnectFailure(latest);
    return currentToken(latest, false);
  }
  return {
    ok: true,
    refreshed: true,
    token: {
      connectionId: conn.id, tenantId: conn.tenantId, tenantName: conn.tenantName,
      accessToken: grant.accessToken, tokenVersion: conn.tokenVersion + 1, expiresAt,
    },
  };
}

/**
 * Claim and send the once-per-outage inbox notice. The claim
 * (reconnectNoticeAt) is released again when sending fails, so the daily
 * keep-alive tries again.
 */
export async function sendPendingReconnectNotice(connectionId: string, partial: Partial<XeroTokenDeps> = {}): Promise<boolean> {
  const deps = resolveDeps(partial);
  const now = deps.now();
  const claimed = await deps.db.xeroConnection.updateMany({
    where: { id: connectionId, status: "NEEDS_RECONNECT", reconnectNoticeAt: null },
    data: { reconnectNoticeAt: now },
  });
  if (claimed.count !== 1) return false;
  const row = await deps.db.xeroConnection.findUnique({
    where: { id: connectionId },
    select: { tenantName: true, statusReason: true, needsReconnectAt: true },
  });
  try {
    await deps.notify({
      connectionId,
      tenantName: row?.tenantName ?? "Xero",
      reason: row?.statusReason ?? "Xero needs reconnecting.",
      needsReconnectAt: row?.needsReconnectAt ?? now,
    });
    return true;
  } catch (error) {
    logger.error({ error: errorText(error), connectionId }, "[xero] the reconnect notice could not be queued; it will be tried again");
    await deps.db.xeroConnection
      .updateMany({ where: { id: connectionId, reconnectNoticeAt: now }, data: { reconnectNoticeAt: null } })
      .catch(() => undefined);
    return false;
  }
}

/**
 * Mark the connection NEEDS_RECONNECT (from CONNECTED only, and only at the
 * expected version when one is given), keeping the row and its tokens for
 * audit, then send the notice once.
 */
export async function markXeroNeedsReconnect(
  input: { connectionId: string; code: XeroReconnectReasonCode; reason?: string; expectedVersion?: number },
  partial: Partial<XeroTokenDeps> = {},
): Promise<XeroTokenFailure> {
  const deps = resolveDeps(partial);
  const reason = input.reason ?? reconnectReasonText(input.code);
  const result = await deps.db.xeroConnection.updateMany({
    where: {
      id: input.connectionId,
      status: "CONNECTED",
      ...(input.expectedVersion !== undefined ? { tokenVersion: input.expectedVersion } : {}),
    },
    data: {
      status: "NEEDS_RECONNECT",
      statusReasonCode: input.code,
      statusReason: reason,
      needsReconnectAt: deps.now(),
      reconnectNoticeAt: null,
      refreshLockId: null,
      refreshLockUntil: null,
    },
  });
  if (result.count === 1) {
    logger.warn({ connectionId: input.connectionId, code: input.code }, "[xero] connection needs reconnecting");
    await sendPendingReconnectNotice(input.connectionId, deps);
    return failure("needs-reconnect", reason, input.code);
  }
  const latest = await readActiveConnection(deps);
  if (latest?.id === input.connectionId && latest.status === "NEEDS_RECONNECT") return needsReconnectFailure(latest);
  // A newer renewal replaced the version that was refused: not a reconnect.
  return failure("transient", "The Xero sign-in changed while it was being checked. Try again.");
}

async function refreshAsLeader(conn: ConnectionRow, leaseId: string, request: XeroTokenRequest, deps: XeroTokenDeps): Promise<XeroTokenOutcome> {
  const fallBack = async (kind: XeroTokenFailureKind, reason: string): Promise<XeroTokenOutcome> => {
    await releaseLease(conn.id, leaseId, deps, reason);
    // A still-valid access token keeps working while renewal is retried later.
    if (kind === "transient" && !request.force && request.rejectedVersion !== conn.tokenVersion && conn.expiresAt.getTime() > deps.now().getTime()) {
      return currentToken(conn, false);
    }
    return failure(kind, reason);
  };

  const creds = await deps.credentials();
  if (!creds.clientId || !creds.clientSecret) return fallBack("configuration", "The Xero Client ID and Secret are not configured in Settings → Integrations.");
  if (!xeroTokenEncryptionAvailable()) {
    // Checked before calling Xero: a rotated refresh token that cannot be
    // stored would be lost.
    return fallBack("configuration", "ENCRYPTION_KEY is not set on the server, so a renewed Xero sign-in cannot be stored safely. Set it, then try again.");
  }
  const refreshToken = decryptSecret(conn.refreshToken);
  if (!refreshToken) return fallBack("configuration", "The stored Xero refresh token could not be read (ENCRYPTION_KEY missing or changed). Reconnect Xero.");

  const exchange = await exchangeRefreshToken(refreshToken, creds, deps);
  if (exchange.kind === "rejected") {
    return markXeroNeedsReconnect({ connectionId: conn.id, code: exchange.code, reason: exchange.reason, expectedVersion: conn.tokenVersion }, deps);
  }
  if (exchange.kind === "transient") {
    logger.warn({ connectionId: conn.id, reason: exchange.reason }, "[xero] sign-in renewal failed for now; the connection stays connected");
    return fallBack("transient", exchange.reason);
  }
  try {
    return await persistGrant(conn, leaseId, exchange.grant, refreshToken, deps);
  } catch (error) {
    // Not stored: Xero lets the previous refresh token be retried for 30 minutes.
    logger.error({ error: errorText(error), connectionId: conn.id }, "[xero] a renewed sign-in could not be stored; it will be renewed again");
    return fallBack("transient", "The renewed Xero sign-in could not be stored. It will be tried again.");
  }
}

/**
 * A valid access token for the active connection, renewing it when needed.
 * Never throws for Xero or token problems: every failure comes back typed.
 */
export async function getXeroAccessToken(initial: XeroTokenRequest = {}, partial: Partial<XeroTokenDeps> = {}): Promise<XeroTokenOutcome> {
  const deps = resolveDeps(partial);
  const deadline = deps.now().getTime() + REFRESH_LEASE_MS + 10_000;
  const maxWaits = Math.ceil((REFRESH_LEASE_MS + 10_000) / LEASE_POLL_MS);
  const request: XeroTokenRequest = { ...initial };
  for (let waits = 0; ; waits += 1) {
    const conn = await readActiveConnection(deps);
    if (!conn) return failure("not-connected", "No active Xero connection");
    if (conn.status === "NEEDS_RECONNECT") return needsReconnectFailure(conn);
    const now = deps.now();
    if (!refreshNeeded(conn, now, request)) return currentToken(conn, false);

    if (!conn.refreshToken) {
      const expired = conn.expiresAt.getTime() <= now.getTime();
      if (expired || request.rejectedVersion !== undefined) {
        return markXeroNeedsReconnect({ connectionId: conn.id, code: "NO_REFRESH_TOKEN", expectedVersion: conn.tokenVersion }, deps);
      }
      // Works until it expires; it cannot be renewed.
      return request.force ? failure("needs-reconnect", reconnectReasonText("NO_REFRESH_TOKEN"), "NO_REFRESH_TOKEN") : currentToken(conn, false);
    }

    const leaseId = randomUUID();
    if (await acquireLease(conn, leaseId, deps)) return refreshAsLeader(conn, leaseId, request, deps);

    // Another process is renewing this version.
    if (usableWhileWaiting(conn, now, request)) return currentToken(conn, false);
    if (waits >= maxWaits || deps.now().getTime() > deadline) {
      return failure("transient", "A Xero sign-in renewal started elsewhere did not finish. It will be tried again.");
    }
    // Wait for a version newer than this one.
    request.rejectedVersion = conn.tokenVersion;
    request.force = false;
    await deps.sleep(LEASE_POLL_MS);
  }
}

export type XeroTenantCheck = { state: "present" } | { state: "removed"; failure: XeroTokenFailure } | { state: "unknown"; reason: string };

/**
 * Is the connected organisation still authorised for this app? (GET
 * /connections with the given token.) Marks NEEDS_RECONNECT when it is gone;
 * a failed check changes nothing.
 */
export async function verifyXeroTenant(token: XeroAccessToken, partial: Partial<XeroTokenDeps> = {}): Promise<XeroTenantCheck> {
  const deps = resolveDeps(partial);
  let res: Response;
  try {
    res = await deps.fetch(XERO_CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { state: "unknown", reason: `Xero could not be reached: ${errorText(error)}` };
  }
  if (!res.ok) return { state: "unknown", reason: `Xero did not list its connections (${res.status}).` };
  let list: unknown;
  try {
    list = await res.json();
  } catch {
    return { state: "unknown", reason: "Xero's connection list could not be read." };
  }
  if (!Array.isArray(list)) return { state: "unknown", reason: "Xero's connection list could not be read." };
  await deps.db.xeroConnection.updateMany({ where: { id: token.connectionId }, data: { lastTenantCheckAt: deps.now() } }).catch(() => undefined);
  const present = list.some((entry) => Boolean(entry) && typeof entry === "object" && (entry as { tenantId?: unknown }).tenantId === token.tenantId);
  if (present) return { state: "present" };
  return { state: "removed", failure: await markXeroNeedsReconnect({ connectionId: token.connectionId, code: "TENANT_REMOVED" }, deps) };
}

/** Message for a token failure, for callers that throw (pushes). */
export function xeroTokenFailureMessage(outcome: XeroTokenFailure): string {
  switch (outcome.kind) {
    case "not-connected":
      return "No active Xero connection";
    case "needs-reconnect":
      return `Xero needs reconnecting: ${outcome.reason}`;
    case "transient":
      return `Xero sign-in could not be renewed right now: ${outcome.reason}`;
    case "configuration":
      return outcome.reason;
  }
}
