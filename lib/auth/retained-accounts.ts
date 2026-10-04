import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { encode, decode } from "next-auth/jwt";

// Retained authority stays server-side. Enrollment returns opaque secrets only
// to the route that sets HttpOnly cookies; never return them in JSON.
const PREFIX = "retained_account_link_v1:";
const MAX_AGE_MS = 8 * 60 * 60 * 1000;
const PROOF_AGE_MS = 10 * 60 * 1000;
const proofs = new WeakSet<object>();
const select = { id: true, email: true, name: true, isActive: true, role: true,
  passwordHash: true, twoFactorEnabled: true, twoFactorMethod: true, totpSecret: true,
  extraRoles: { select: { role: true } } } as const;
type Identity = Prisma.UserGetPayload<{ select: typeof select }>;
type Proof = Readonly<{ userId: string; credentialStamp: string; authenticatedAt: number; enrollmentNonce?: string }>;
type Member = { contextId: string; userId: string; credentialStamp: string; secretHash: string; revokedAt: string | null };
type Link = { version: 1; ownerId: string; createdAt: string; expiresAt: string; consentAt: string; members: Member[] };
export type RetainedAccountSecrets = { browserSecret: string; contextId: string; contextSecret: string };

export class RetainedAccountError extends Error {
  constructor(public code: "UNAUTHORIZED" | "CONSENT_REQUIRED" | "ACCOUNT_PAIR_REQUIRED" | "AUTHENTICATION_EXPIRED") { super(code); }
}
const denied = () => new RetainedAccountError("UNAUTHORIZED");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const validSecret = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validContext = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
function equal(a: string, b: string) { return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
function credentialStamp(user: Identity) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Authentication signing key is unavailable");
  return createHmac("sha256", secret).update(JSON.stringify({ id: user.id, password: user.passwordHash,
    twoFactorEnabled: user.twoFactorEnabled, twoFactorMethod: user.twoFactorMethod, totpSecret: user.totpSecret,
    role: user.role, extraRoles: user.extraRoles.map(item => item.role).sort() })).digest("hex");
}
function eligible(user: Identity | null): user is Identity {
  return Boolean(user?.isActive && user.passwordHash && [Role.ADMIN, Role.CLEANER].includes(user.role as "ADMIN" | "CLEANER"));
}
async function readIdentity(userId: string, tx: Pick<Prisma.TransactionClient, "user"> = db) {
  const user = await tx.user.findUnique({ where: { id: userId }, select });
  if (!eligible(user)) throw denied();
  return user;
}
function parseLink(value: unknown): Link | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Link;
  if (row.version !== 1 || typeof row.ownerId !== "string" || !Number.isFinite(Date.parse(row.expiresAt)) ||
      !Array.isArray(row.members) || row.members.length !== 2 || new Set(row.members.map(member => member?.userId)).size !== 2 ||
      new Set(row.members.map(member => member?.contextId)).size !== 2 ||
      !row.members.every(member => member && validContext(member.contextId) && typeof member.userId === "string" && validSecret(member.secretHash) && validSecret(member.credentialStamp) && (member.revokedAt === null || typeof member.revokedAt === "string")) ||
      !row.members.some(member => member.userId === row.ownerId)) return null;
  return row;
}

/** Reuses the existing password lockout, active-user, maintenance and MFA gates. */
export async function authenticateRetainedIdentity(credentials: { email: string; password: string }, cookieHeader: string): Promise<Proof> {
  const { createAuthOptions } = await import("./auth-options");
  const provider = createAuthOptions().providers.find(item => item.id === "credentials" || item.type === "credentials") as any;
  const authorize = provider?.options?.authorize ?? provider?.authorize;
  if (typeof authorize !== "function") throw denied();
  const authenticated = await authorize(credentials, { headers: { cookie: cookieHeader } });
  if (!authenticated?.id) throw denied();
  const user = await readIdentity(authenticated.id);
  const proof = Object.freeze({ userId: user.id, credentialStamp: credentialStamp(user), authenticatedAt: Date.now() });
  proofs.add(proof);
  return proof;
}

/** Both fresh proofs + explicit consent are required; IDs/roles from HTTP cannot mint a link. */
export async function linkRetainedAccounts(owner: Proof, other: Proof, consent: boolean) {
  if (consent !== true) throw new RetainedAccountError("CONSENT_REQUIRED");
  const now = Date.now();
  for (const proof of [owner, other]) {
    if (!proof || !proofs.has(proof)) throw denied();
    if (now - proof.authenticatedAt > PROOF_AGE_MS || proof.authenticatedAt > now) throw new RetainedAccountError("AUTHENTICATION_EXPIRED");
  }
  if (owner.userId === other.userId) throw new RetainedAccountError("ACCOUNT_PAIR_REQUIRED");
  // Consume before any await, including parallel retries in the same request.
  proofs.delete(owner); proofs.delete(other);
  const browserSecret = randomBytes(32).toString("hex");
  const key = PREFIX + hash(browserSecret);
  const issued = [owner, other].map(proof => ({ userId: proof.userId, contextId: randomBytes(16).toString("hex"), contextSecret: randomBytes(32).toString("hex") }));
  const expiresAt = new Date(Math.min(owner.authenticatedAt, other.authenticatedAt) + MAX_AGE_MS).toISOString();
  await db.$transaction(async tx => {
    for (const userId of [owner.userId, other.userId].sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR SHARE`;
    for (const proof of [owner, other]) if (proof.enrollmentNonce) {
      await tx.appSetting.create({ data: { key: "retained_account_proof_used:" + proof.enrollmentNonce, value: { usedAt: new Date(now).toISOString() } } });
    }
    const users = await Promise.all([readIdentity(owner.userId, tx), readIdentity(other.userId, tx)]);
    if (new Set(users.map(user => user.role)).size !== 2) throw new RetainedAccountError("ACCOUNT_PAIR_REQUIRED");
    users.forEach((user, index) => { if (!equal(credentialStamp(user), [owner, other][index].credentialStamp)) throw denied(); });
    const link: Link = { version: 1, ownerId: owner.userId, createdAt: new Date(now).toISOString(), consentAt: new Date(now).toISOString(), expiresAt,
      members: issued.map((entry, index) => ({ contextId: entry.contextId, userId: entry.userId, credentialStamp: [owner, other][index].credentialStamp, secretHash: hash(entry.contextSecret), revokedAt: null })) };
    await tx.appSetting.create({ data: { key, value: link as unknown as Prisma.InputJsonValue } });
    await tx.auditLog.create({ data: { userId: owner.userId, action: "RETAINED_ACCOUNTS_LINKED", entity: "RetainedAccountLink", entityId: key,
      after: { userIds: issued.map(entry => entry.userId), expiresAt, consentAt: link.consentAt } } });
  });
  return { browserSecret, expiresAt, accounts: issued };
}

async function resolveInTransaction(secrets: RetainedAccountSecrets, tx: Prisma.TransactionClient, now: number) {
  if (!validSecret(secrets.browserSecret) || !validSecret(secrets.contextSecret) || !validContext(secrets.contextId)) throw denied();
  const key = PREFIX + hash(secrets.browserSecret);
  const row = await tx.appSetting.findUnique({ where: { key }, select: { value: true } });
  const link = parseLink(row?.value);
  if (!link || Date.parse(link.expiresAt) <= now) throw denied();
  const member = link.members.find(item => item.contextId === secrets.contextId);
  if (!member || member.revokedAt || !equal(member.secretHash, hash(secrets.contextSecret))) throw denied();
  const [user, owner] = await Promise.all([readIdentity(member.userId, tx), readIdentity(link.ownerId, tx)]);
  const ownerRecord = link.members.find(item => item.userId === owner.id)!;
  if (!equal(member.credentialStamp, credentialStamp(user)) || !equal(ownerRecord.credentialStamp, credentialStamp(owner))) throw denied();
  return { key, link, member, user };
}

/** Reads current authority on every request, with fixed expiry and no cookie/global-account mutation. */
export async function resolveRetainedAccount(secrets: RetainedAccountSecrets) {
  const { user, link } = await resolveInTransaction(secrets, db, Date.now());
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role,
    primaryRole: user.role, heldRoles: [user.role, ...user.extraRoles.map(item => item.role)] }, expires: link.expiresAt };
}

/** Revoke this account or the entire browser pair; preserve the consent and revocation audit. */
export async function revokeRetainedAccount(secrets: RetainedAccountSecrets, all = false) {
  if (!validSecret(secrets.browserSecret)) throw denied();
  const key = PREFIX + hash(secrets.browserSecret);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "key" FROM "AppSetting" WHERE "key" = ${key} FOR UPDATE`;
    const resolved = await resolveInTransaction(secrets, tx, Date.now());
    const revokedAt = new Date().toISOString();
    const link = { ...resolved.link, members: resolved.link.members.map(member => all || member.contextId === secrets.contextId ? { ...member, revokedAt } : member) };
    await tx.appSetting.update({ where: { key }, data: { value: link as unknown as Prisma.InputJsonValue } });
    await tx.auditLog.create({ data: { userId: resolved.user.id, action: all ? "RETAINED_ACCOUNTS_REVOKED" : "RETAINED_ACCOUNT_REVOKED", entity: "RetainedAccountLink", entityId: key,
      after: { contextIds: link.members.filter(member => member.revokedAt === revokedAt).map(member => member.contextId), revokedAt } } });
  });
}

/** Short-lived HttpOnly enrollment proof, bound to the genuine initiating user. */
export async function prepareRetainedIdentity(credentials: { email: string; password: string }, cookieHeader: string, initiatorId: string) {
  const proof = await authenticateRetainedIdentity(credentials, cookieHeader);
  proofs.delete(proof);
  return encode({ secret: process.env.NEXTAUTH_SECRET!, maxAge: PROOF_AGE_MS / 1000,
    token: { ...proof, purpose: "retained-account-enrollment", initiatorId, enrollmentNonce: randomBytes(32).toString("hex") } });
}
export async function completeRetainedEnrollment(ownerTicket: string, otherTicket: string, initiatorId: string, consent: boolean) {
  const decoded = await Promise.all([ownerTicket, otherTicket].map(token => decode({ token, secret: process.env.NEXTAUTH_SECRET! })));
  const restored = decoded.map(value => {
    if (!value || value.purpose !== "retained-account-enrollment" || value.initiatorId !== initiatorId ||
      typeof value.userId !== "string" || !validSecret(value.credentialStamp) || !validSecret(value.enrollmentNonce) || typeof value.authenticatedAt !== "number") throw denied();
    const proof = Object.freeze({ userId: value.userId, credentialStamp: value.credentialStamp, authenticatedAt: value.authenticatedAt, enrollmentNonce: value.enrollmentNonce });
    proofs.add(proof); return proof;
  });
  if (restored[0].userId !== initiatorId) throw denied();
  return linkRetainedAccounts(restored[0], restored[1], consent);
}
export async function listRetainedAccounts(browserSecret: string, initiatorId: string) {
  if (!validSecret(browserSecret)) return [];
  const row = await db.appSetting.findUnique({ where: { key: PREFIX + hash(browserSecret) }, select: { value: true } });
  const link = parseLink(row?.value);
  if (!link || link.ownerId !== initiatorId) return [];
  let ownerValid = false;
  try { const owner = await readIdentity(link.ownerId); ownerValid = equal(link.members.find(member => member.userId === owner.id)!.credentialStamp, credentialStamp(owner)); } catch { /* Revoked owner invalidates this pair. */ }
  return Promise.all(link.members.map(async member => {
    let available = ownerValid && !member.revokedAt && Date.parse(link.expiresAt) > Date.now();
    let user: Identity | null = null;
    try { user = await readIdentity(member.userId); available = available && equal(member.credentialStamp, credentialStamp(user)); } catch { available = false; }
    return { contextId: member.contextId, name: user?.name ?? "Account", email: user?.email ?? "", role: user?.role ?? null, expiresAt: link.expiresAt, available };
  }));
}

/** Listing requires one still-valid opaque member secret, not just a context ID. */
export async function listRetainedAccountsForBrowser(browserSecret: string, secretFor: (contextId: string) => string) {
  if (!validSecret(browserSecret)) return [];
  const row = await db.appSetting.findUnique({ where: { key: PREFIX + hash(browserSecret) }, select: { value: true } });
  const link = parseLink(row?.value);
  if (!link) return [];
  for (const member of link.members) {
    try {
      await resolveRetainedAccount({ browserSecret, contextId: member.contextId, contextSecret: secretFor(member.contextId) });
      return listRetainedAccounts(browserSecret, link.ownerId);
    } catch { /* Try another still-authorized identity; never fallback to a global account. */ }
  }
  return [];
}
