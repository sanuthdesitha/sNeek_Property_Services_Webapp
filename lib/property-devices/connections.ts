import "server-only";
/**
 * Organisation-level Ring and Minut connections (2026-11-20). ADMIN only; the
 * routes verify the person's own PIN (tier C) before anything here runs.
 *
 * Ring keeps ONLY an encrypted refresh token (enc:v1, lib/security/encryption)
 * and a generated hardware id. The password and 2FA code are used for the one
 * sign-in request and never stored, logged, audited or returned. Ring rotates
 * refresh tokens on every renewal: the new token is written with a
 * compare-and-set on `tokenVersion` before the access token is used, so a lost
 * token never strands the connection mid-sync.
 *
 * Minut uses the official API's client id and secret, kept in the existing
 * integrations credentials (AppSetting `integrationCredentials`, keys
 * `minutClientId` / `minutClientSecret`, env MINUT_CLIENT_ID /
 * MINUT_CLIENT_SECRET as fallback), like Xero's.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { defaultFetchDeps, ProviderHttpError, type ProviderFetchDeps } from "./providers/http";
import { newRingHardwareId, ringSignIn } from "./providers/ring-client";
import { minutCheck, type MinutCredentials } from "./providers/minut-client";
import type { ConnectedProvider, ConnectionStatusValue, ProviderConnectionView, PropertyDeviceSettings } from "./types";

const CREDENTIAL_KEY = "integrationCredentials";

export async function getMinutCredentials(): Promise<MinutCredentials> {
  const row = await db.appSetting.findUnique({ where: { key: CREDENTIAL_KEY } });
  const creds = (row?.value as Record<string, unknown> | null) ?? {};
  return {
    clientId: (typeof creds.minutClientId === "string" ? creds.minutClientId : "") || process.env.MINUT_CLIENT_ID || "",
    clientSecret: (typeof creds.minutClientSecret === "string" ? creds.minutClientSecret : "") || process.env.MINUT_CLIENT_SECRET || "",
  };
}

/** Store the Minut client id and secret in the integrations credentials (merge, audited without values). */
export async function saveMinutCredentials(actorId: string, input: MinutCredentials): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CREDENTIAL_KEY}))`;
    const row = await tx.appSetting.findUnique({ where: { key: CREDENTIAL_KEY } });
    const current = (row?.value as Record<string, unknown> | null) ?? {};
    const value = { ...current, minutClientId: input.clientId.trim(), minutClientSecret: input.clientSecret.trim() } as Prisma.InputJsonValue;
    await tx.appSetting.upsert({ where: { key: CREDENTIAL_KEY }, create: { key: CREDENTIAL_KEY, value }, update: { value } });
    await tx.auditLog.create({ data: { userId: actorId, action: "DEVICE_PROVIDER_CREDENTIALS_SAVED", entity: "AppSetting", entityId: CREDENTIAL_KEY, after: { provider: "MINUT", minutClientId: "set", minutClientSecret: "set" } } });
  });
}

export function encryptionAvailable(): boolean {
  try {
    return Boolean(encryptSecret("probe"));
  } catch {
    return false;
  }
}

function maskEmail(email: string): string {
  const [name, domain] = email.trim().split("@");
  if (!domain) return "the shared account";
  return `${name.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(name.length - 1, 6)))}@${domain}`;
}

async function upsertConnection(provider: ConnectedProvider, data: Prisma.DeviceProviderConnectionUpdateInput): Promise<void> {
  await db.deviceProviderConnection.upsert({
    where: { provider },
    create: { ...(data as Prisma.DeviceProviderConnectionCreateInput), provider },
    update: data,
  });
}

export type RingConnectResult = { kind: "needs_code"; prompt: string } | { kind: "connected" };

/**
 * Sign in with the shared Ring account. First call (no code): Ring sends a code
 * and this answers `needs_code`. Second call with the code stores the refresh
 * token. A hardware id is generated once and kept for the connection.
 */
export async function connectRing(actorId: string, input: { email: string; password: string; twoFactorCode?: string }, deps: ProviderFetchDeps = defaultFetchDeps()): Promise<RingConnectResult> {
  if (!encryptionAvailable()) throw new ProviderHttpError("The server has no ENCRYPTION_KEY, so the Ring sign-in cannot be stored safely. Ask whoever runs the server to set it.", null, "refused");
  const existing = await db.deviceProviderConnection.findUnique({ where: { provider: "RING" }, select: { hardwareId: true } });
  const hardwareId = existing?.hardwareId ?? newRingHardwareId();
  if (!existing?.hardwareId) await upsertConnection("RING", { hardwareId });
  const result = await ringSignIn(deps, { email: input.email, password: input.password, twoFactorCode: input.twoFactorCode, hardwareId });
  if (result.kind === "needs_code") return result;
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.deviceProviderConnection.update({
      where: { provider: "RING" },
      data: {
        status: "CONNECTED",
        accountLabel: maskEmail(input.email),
        refreshToken: encryptSecret(result.refreshToken),
        tokenVersion: { increment: 1 },
        connectedAt: now,
        connectedById: actorId,
        consecutiveFailures: 0,
        lastError: null,
        lastErrorAt: null,
        failureNoticeAt: null,
      },
    });
    await tx.auditLog.create({ data: { userId: actorId, action: "DEVICE_PROVIDER_CONNECTED", entity: "DeviceProviderConnection", entityId: "RING", after: { provider: "RING", account: maskEmail(input.email) } } });
  });
  return { kind: "connected" };
}

/** Check the Minut client id and secret, then mark Minut connected. */
export async function connectMinut(actorId: string, deps: ProviderFetchDeps = defaultFetchDeps()): Promise<void> {
  const credentials = await getMinutCredentials();
  if (!credentials.clientId || !credentials.clientSecret) throw new ProviderHttpError("Minut needs an API client id and client secret first.", null, "refused");
  const label = await minutCheck(deps, credentials);
  const now = new Date();
  await upsertConnection("MINUT", { status: "CONNECTED", accountLabel: label ? (label.includes("@") ? maskEmail(label) : label) : null, connectedAt: now, connectedById: actorId, consecutiveFailures: 0, lastError: null, lastErrorAt: null, failureNoticeAt: null });
  await db.auditLog.create({ data: { userId: actorId, action: "DEVICE_PROVIDER_CONNECTED", entity: "DeviceProviderConnection", entityId: "MINUT", after: { provider: "MINUT" } } });
}

/** Disconnect: forget the stored sign-in. Devices and readings already recorded stay. */
export async function disconnectProvider(actorId: string, provider: ConnectedProvider): Promise<void> {
  const updated = await db.deviceProviderConnection.updateMany({
    where: { provider },
    data: { status: "NOT_CONNECTED", refreshToken: null, accountLabel: null, tokenVersion: { increment: 1 }, syncLeaseToken: null, syncLeaseUntil: null },
  });
  if (updated.count === 0) await db.deviceProviderConnection.create({ data: { provider, status: "NOT_CONNECTED" } });
  await db.auditLog.create({ data: { userId: actorId, action: "DEVICE_PROVIDER_DISCONNECTED", entity: "DeviceProviderConnection", entityId: provider, after: { provider } } });
}

/** The stored Ring refresh token, decrypted, with the version it was read at. */
export async function readRingSecret(): Promise<{ refreshToken: string; hardwareId: string; tokenVersion: number } | null> {
  const row = await db.deviceProviderConnection.findUnique({ where: { provider: "RING" }, select: { refreshToken: true, hardwareId: true, tokenVersion: true, status: true } });
  if (!row?.refreshToken || !row.hardwareId || row.status !== "CONNECTED") return null;
  const refreshToken = decryptSecret(row.refreshToken);
  if (!refreshToken || refreshToken.startsWith("enc:v1:")) return null;
  return { refreshToken, hardwareId: row.hardwareId, tokenVersion: row.tokenVersion };
}

/**
 * Persist a rotated Ring refresh token atomically: compare-and-set on the
 * version that was read. Losing the race means another process already
 * rotated it; the caller stops rather than overwrite a newer token.
 */
export async function persistRotatedRingToken(expectedVersion: number, newRefreshToken: string): Promise<number> {
  const sealed = encryptSecret(newRefreshToken);
  const updated = await db.deviceProviderConnection.updateMany({
    where: { provider: "RING", tokenVersion: expectedVersion, status: "CONNECTED" },
    data: { refreshToken: sealed, tokenVersion: { increment: 1 } },
  });
  if (updated.count !== 1) throw new ProviderHttpError("The Ring sign-in changed during this sync (another sync or a reconnect). This run stopped; the next one uses the new sign-in.", null, "transient");
  return expectedVersion + 1;
}

export async function connectionViews(settings: PropertyDeviceSettings): Promise<ProviderConnectionView[]> {
  const [rows, minut] = await Promise.all([db.deviceProviderConnection.findMany(), getMinutCredentials()]);
  const encryption = encryptionAvailable();
  return (["RING", "MINUT"] as const).map((provider) => {
    const row = rows.find((candidate) => candidate.provider === provider);
    const missing: string[] = [];
    if (provider === "RING" && !encryption) missing.push("ENCRYPTION_KEY on the server (needed to store the Ring sign-in safely)");
    if (provider === "MINUT" && !minut.clientId) missing.push("Minut API client id");
    if (provider === "MINUT" && !minut.clientSecret) missing.push("Minut API client secret");
    const rawStatus = (row?.status ?? "NOT_CONNECTED") as ConnectionStatusValue;
    const status: ConnectionStatusValue = provider === "MINUT" && missing.length > 0 ? "NOT_CONNECTED" : rawStatus;
    const failures = row?.consecutiveFailures ?? 0;
    return {
      provider,
      status,
      missing,
      accountLabel: row?.accountLabel ?? null,
      connectedAt: row?.connectedAt?.toISOString() ?? null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      consecutiveFailures: failures,
      failing: status === "NEEDS_RECONNECT" || (status === "CONNECTED" && failures >= settings.failureNoticeAfter),
    };
  });
}
