import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/security/encryption";
import { checkMetaAccount, exchangeMetaCode, extendMetaUserToken, META_DIALOG, META_SCOPES, MetaConnectError, revokeMetaPermissions } from "./networks/meta";
import type { HttpClient } from "./networks/http";
import type { SocialNetwork } from "./networks";
import type { AccountView } from "./view-types";

/**
 * Connected social accounts (2026-11-17). sNeek's own business accounts,
 * connected through each network's official sign-in by an administrator
 * with their own PIN. The Meta app's secret and every token are encrypted
 * with the server's credential key (ENCRYPTION_KEY, `encryptSecret`); they
 * are never returned to a browser, an agent or an AI request, and never
 * logged. Only the publish and check paths decrypt a token, in memory.
 */

export const META_APP_KEY = "social_meta_app_v1";
const STATE_TTL_MS = 10 * 60_000;
const REFRESH_WITHIN_MS = 7 * 86_400_000;

type MetaAppRow = { appId: string; appSecretCiphertext: string | null; updatedAt: string; updatedById: string };

export class SocialAccountError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "SocialAccountError";
  }
}

async function readMetaApp(): Promise<MetaAppRow | null> {
  const row = await db.appSetting.findUnique({ where: { key: META_APP_KEY } });
  const value = row?.value as Partial<MetaAppRow> | null | undefined;
  if (!value || typeof value.appId !== "string") return null;
  return { appId: value.appId, appSecretCiphertext: typeof value.appSecretCiphertext === "string" ? value.appSecretCiphertext : null, updatedAt: String(value.updatedAt ?? ""), updatedById: String(value.updatedById ?? "") };
}

/** What the screen may show: the App ID and whether a secret is stored. Never the secret. */
export async function metaAppState(): Promise<{ appId: string | null; hasSecret: boolean; updatedAt: string | null }> {
  const app = await readMetaApp();
  return { appId: app?.appId ?? null, hasSecret: Boolean(app?.appSecretCiphertext), updatedAt: app?.updatedAt || null };
}

/** Saves the App ID and, when given, a new App Secret (the route has verified the PIN). */
export async function saveMetaApp(input: { appId: string; appSecret?: string | null; actorId: string }): Promise<void> {
  if (!/^\d{5,25}$/.test(input.appId.trim())) throw new SocialAccountError(400, "The App ID is the number shown at the top of your Meta app's dashboard.");
  const current = await readMetaApp();
  let ciphertext = current?.appSecretCiphertext ?? null;
  if (input.appSecret) {
    if (!/^[A-Za-z0-9]{16,64}$/.test(input.appSecret.trim())) throw new SocialAccountError(400, "That does not look like a Meta App Secret.");
    try {
      ciphertext = encryptSecret(input.appSecret.trim());
    } catch {
      throw new SocialAccountError(503, "ENCRYPTION_KEY is not set on the server, so the secret cannot be stored safely. Nothing was saved.");
    }
  }
  const value: MetaAppRow = { appId: input.appId.trim(), appSecretCiphertext: ciphertext, updatedAt: new Date().toISOString(), updatedById: input.actorId };
  await db.$transaction([
    db.appSetting.upsert({ where: { key: META_APP_KEY }, create: { key: META_APP_KEY, value }, update: { value } }),
    db.auditLog.create({ data: { userId: input.actorId, action: "SOCIAL_META_APP_SAVED", entity: "AppSetting", entityId: META_APP_KEY, after: { appId: value.appId, secretReplaced: Boolean(input.appSecret) } } }),
  ]);
}

async function metaCredentials(): Promise<{ appId: string; appSecret: string }> {
  const app = await readMetaApp();
  const secret = readSecret(app?.appSecretCiphertext);
  if (!app || !secret) throw new SocialAccountError(409, "Add the Meta App ID and App Secret first.");
  return { appId: app.appId, appSecret: secret };
}

/** A stored secret, decrypted; null for plaintext or anything that cannot be decrypted (fails closed). */
function readSecret(ciphertext: string | null | undefined): string | null {
  if (!ciphertext || !isEncrypted(ciphertext)) return null;
  const value = decryptSecret(ciphertext);
  return value && !value.startsWith("enc:") ? value : null;
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** Starts the Facebook sign-in: a single-use state (only its hash stored), 10 minutes. */
export async function startMetaConnect(input: { actorId: string; redirectUri: string; now?: Date }): Promise<{ authUrl: string }> {
  const { appId } = await metaCredentials();
  const state = randomBytes(32).toString("base64url");
  const now = input.now ?? new Date();
  await db.socialOAuthState.create({ data: { network: "META", stateHash: hashState(state), createdById: input.actorId, expiresAt: new Date(now.getTime() + STATE_TTL_MS) } });
  const url = new URL(META_DIALOG);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_SCOPES.join(","));
  return { authUrl: url.toString() };
}

function encrypt(value: string): string {
  const result = encryptSecret(value);
  if (!result) throw new SocialAccountError(500, "The sign-in could not be stored.");
  return result;
}

/** Completes the sign-in for the person who started it, once, within 10 minutes. */
export async function completeMetaConnect(input: { actorId: string; state: string; code: string; redirectUri: string; http: HttpClient; now?: Date }): Promise<{ facebook: string; instagram: string | null; note: string | null }> {
  const now = input.now ?? new Date();
  const consumed = await db.socialOAuthState.updateMany({ where: { stateHash: hashState(input.state), createdById: input.actorId, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (consumed.count !== 1) throw new SocialAccountError(400, "This sign-in link has expired or was already used. Press Connect again.");
  const credentials = await metaCredentials();
  if (!process.env.ENCRYPTION_KEY?.trim()) throw new SocialAccountError(503, "ENCRYPTION_KEY is not set on the server, so the sign-in cannot be stored safely. Nothing was connected.");
  let connection;
  try {
    connection = await exchangeMetaCode({ http: input.http }, { ...credentials, redirectUri: input.redirectUri, code: input.code, now });
  } catch (error) {
    throw new SocialAccountError(502, error instanceof MetaConnectError ? error.message : "Facebook could not be reached. Nothing was connected.");
  }
  const instagramLimit = connection.instagram
    ? await checkMetaAccount({ http: input.http }, { network: "INSTAGRAM", externalId: connection.instagram.id, token: connection.page.token })
    : null;
  const result = await db.$transaction(async (tx) => {
    await tx.socialAccount.updateMany({ where: { network: { in: ["FACEBOOK", "INSTAGRAM"] }, status: { not: "DISCONNECTED" } }, data: { status: "DISCONNECTED", disconnectedAt: now, disconnectedById: input.actorId, tokenCiphertext: null, refreshCiphertext: null, statusReason: "Replaced by a new connection" } });
    const facebook = await tx.socialAccount.create({
      data: {
        network: "FACEBOOK",
        externalId: connection.page.id,
        displayName: connection.page.name,
        tokenCiphertext: encrypt(connection.page.token),
        tokenExpiresAt: null,
        refreshCiphertext: encrypt(connection.userToken),
        scopes: connection.scopes,
        connectedById: input.actorId,
        connectedAt: now,
        status: "CONNECTED",
        lastCheckAt: now,
        lastCheckResult: "Connected: the Page name was read.",
        facts: { userTokenExpiresAt: connection.userTokenExpiresAt?.toISOString() ?? null, otherPages: connection.otherPages } as Prisma.InputJsonValue,
      },
    });
    let instagramId: string | null = null;
    if (connection.instagram) {
      const instagram = await tx.socialAccount.create({
        data: {
          network: "INSTAGRAM",
          externalId: connection.instagram.id,
          displayName: `@${connection.instagram.username.replace(/^@/, "")}`,
          parentAccountId: facebook.id,
          tokenCiphertext: encrypt(connection.page.token),
          scopes: connection.scopes,
          connectedById: input.actorId,
          connectedAt: now,
          status: "CONNECTED",
          lastCheckAt: now,
          lastCheckResult: instagramLimit?.ok ? "Connected: the publishing limit was read." : "Connected; the publishing limit could not be read.",
          facts: (instagramLimit?.ok ? { publishingLimit: instagramLimit.publishingLimit } : {}) as Prisma.InputJsonValue,
        },
      });
      instagramId = instagram.id;
    }
    await tx.auditLog.create({ data: { userId: input.actorId, action: "SOCIAL_ACCOUNT_CONNECTED", entity: "SocialAccount", entityId: facebook.id, after: { network: "META", page: connection.page.name, instagram: connection.instagram?.username ?? null, scopes: connection.scopes } } });
    return { facebook: facebook.id, instagram: instagramId };
  });
  const missing = META_SCOPES.filter((scope) => !connection.scopes.includes(scope));
  const notes = [
    connection.instagram ? null : "No Instagram professional account is linked to this Page, so only Facebook was connected.",
    connection.otherPages ? `You shared ${connection.otherPages + 1} Pages; sNeek connected "${connection.page.name}".` : null,
    missing.length ? `Not granted: ${missing.join(", ")}. Posting may be refused; reach and likes will read "not recorded".` : null,
  ].filter(Boolean);
  return { ...result, note: notes.length ? notes.join(" ") : null };
}

export type UsableAccount = { id: string; network: SocialNetwork; externalId: string; displayName: string; token: string };

async function markNeedsReconnect(id: string, reason: string) {
  await db.socialAccount.updateMany({ where: { id, status: "CONNECTED" }, data: { status: "NEEDS_RECONNECT", statusReason: reason.slice(0, 300) } });
}

/**
 * The account a network posts through, with its token decrypted in memory,
 * or null (not connected, needs reconnect, expired). A sign-in close to its
 * expiry is extended first; an expired one is marked "needs reconnect".
 */
export async function usableAccount(network: SocialNetwork, http: HttpClient, now = new Date()): Promise<UsableAccount | null> {
  const account = await db.socialAccount.findFirst({ where: { network, status: "CONNECTED" }, orderBy: { connectedAt: "desc" } });
  if (!account?.tokenCiphertext) return null;
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= now.getTime()) {
    await markNeedsReconnect(account.id, "The sign-in expired. Reconnect in Social accounts.");
    return null;
  }
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() - now.getTime() < REFRESH_WITHIN_MS && account.refreshCiphertext) {
    const refreshed = await refreshAccountToken(account.id, account.refreshCiphertext, http, now);
    if (!refreshed) return null;
  }
  const fresh = await db.socialAccount.findUnique({ where: { id: account.id } });
  const token = readSecret(fresh?.tokenCiphertext);
  if (!fresh || fresh.status !== "CONNECTED" || !token) {
    if (fresh?.status === "CONNECTED") await markNeedsReconnect(account.id, "The stored sign-in could not be read. Reconnect in Social accounts.");
    return null;
  }
  return { id: fresh.id, network, externalId: fresh.externalId, displayName: fresh.displayName, token };
}

/** Extends a sign-in that is close to expiry; an extension Meta refuses for good marks it "needs reconnect". */
async function refreshAccountToken(accountId: string, refreshCiphertext: string, http: HttpClient, now: Date): Promise<boolean> {
  const userToken = readSecret(refreshCiphertext);
  if (!userToken) {
    await markNeedsReconnect(accountId, "The stored sign-in could not be read. Reconnect in Social accounts.");
    return false;
  }
  let credentials;
  try {
    credentials = await metaCredentials();
  } catch {
    return true;
  }
  const result = await extendMetaUserToken({ http }, { ...credentials, userToken, now }).catch(() => ({ error: "Meta could not be reached.", reconnect: false }));
  if ("error" in result) {
    if (result.reconnect) await markNeedsReconnect(accountId, result.error);
    return !result.reconnect;
  }
  await db.socialAccount.update({ where: { id: accountId }, data: { tokenCiphertext: encrypt(result.token), refreshCiphertext: encrypt(result.token), tokenExpiresAt: result.expiresAt, lastCheckAt: now, lastCheckResult: "Sign-in extended." } });
  return true;
}

/** Marks an account after a network refused its sign-in during a post. */
export async function accountNeedsReconnect(accountId: string, reason: string): Promise<void> {
  await markNeedsReconnect(accountId, reason);
}

export async function checkAccount(input: { accountId: string; http: HttpClient; now?: Date }): Promise<{ ok: boolean; message: string }> {
  const now = input.now ?? new Date();
  const account = await db.socialAccount.findUnique({ where: { id: input.accountId } });
  if (!account || account.status === "DISCONNECTED") throw new SocialAccountError(404, "This account is not connected.");
  if (account.network !== "FACEBOOK" && account.network !== "INSTAGRAM") throw new SocialAccountError(409, "sNeek cannot check this network.");
  const token = readSecret(account.tokenCiphertext);
  if (!token) {
    await markNeedsReconnect(account.id, "The stored sign-in could not be read. Reconnect in Social accounts.");
    return { ok: false, message: "The stored sign-in could not be read. Reconnect in Social accounts." };
  }
  const result = await checkMetaAccount({ http: input.http }, { network: account.network, externalId: account.externalId, token });
  if (!result.ok) {
    await db.socialAccount.update({ where: { id: account.id }, data: { lastCheckAt: now, lastCheckResult: result.reason, ...(result.reconnect ? { status: "NEEDS_RECONNECT", statusReason: result.reason } : {}) } });
    return { ok: false, message: result.reason };
  }
  await db.socialAccount.update({
    where: { id: account.id },
    data: { lastCheckAt: now, lastCheckResult: "Working", status: "CONNECTED", statusReason: null, ...(result.publishingLimit ? { facts: { ...((account.facts as Record<string, unknown>) ?? {}), publishingLimit: result.publishingLimit } as Prisma.InputJsonValue } : {}) },
  });
  return { ok: true, message: "Working" };
}

/** Disconnects (Facebook also disconnects the Instagram account it carries) and asks Meta to remove the grant. */
export async function disconnectAccount(input: { accountId: string; actorId: string; http: HttpClient; now?: Date }): Promise<{ revokedAtNetwork: boolean }> {
  const now = input.now ?? new Date();
  const account = await db.socialAccount.findUnique({ where: { id: input.accountId } });
  if (!account || account.status === "DISCONNECTED") throw new SocialAccountError(404, "This account is not connected.");
  const facebook = account.network === "FACEBOOK" ? account : account.parentAccountId ? await db.socialAccount.findUnique({ where: { id: account.parentAccountId } }) : null;
  const userToken = readSecret(facebook?.refreshCiphertext);
  const revokedAtNetwork = account.network === "FACEBOOK" && userToken ? await revokeMetaPermissions({ http: input.http }, userToken) : false;
  const ids = account.network === "FACEBOOK" ? (await db.socialAccount.findMany({ where: { OR: [{ id: account.id }, { parentAccountId: account.id }] }, select: { id: true } })).map((row) => row.id) : [account.id];
  await db.$transaction([
    db.socialAccount.updateMany({ where: { id: { in: ids } }, data: { status: "DISCONNECTED", disconnectedAt: now, disconnectedById: input.actorId, tokenCiphertext: null, refreshCiphertext: null, statusReason: "Disconnected in sNeek" } }),
    db.auditLog.create({ data: { userId: input.actorId, action: "SOCIAL_ACCOUNT_DISCONNECTED", entity: "SocialAccount", entityId: account.id, after: { network: account.network, accounts: ids.length, revokedAtNetwork } } }),
  ]);
  return { revokedAtNetwork };
}

export async function listAccounts(): Promise<AccountView[]> {
  const rows = await db.socialAccount.findMany({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } });
  const users = await db.user.findMany({ where: { id: { in: rows.map((row) => row.connectedById) } }, select: { id: true, name: true, email: true } });
  const names = new Map(users.map((user) => [user.id, user.name || user.email || null]));
  return rows.map((row) => {
    const facts = (row.facts ?? {}) as { publishingLimit?: { used?: unknown; total?: unknown } };
    return {
      id: row.id,
      network: row.network as SocialNetwork,
      displayName: row.displayName,
      status: row.status as AccountView["status"],
      statusReason: row.statusReason,
      connectedByName: names.get(row.connectedById) ?? null,
      connectedAt: row.connectedAt.toISOString(),
      lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
      lastCheckResult: row.lastCheckResult,
      scopes: row.scopes,
      tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
      publishingLimit: facts.publishingLimit
        ? { used: typeof facts.publishingLimit.used === "number" ? facts.publishingLimit.used : null, total: typeof facts.publishingLimit.total === "number" ? facts.publishingLimit.total : null }
        : null,
    };
  });
}

/** Where Facebook sends the person back after its sign-in page. */
export function metaRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/admin/marketing/social/meta/callback`;
}
