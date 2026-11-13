import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { heldRoles } from "@/lib/auth/roles";
import { getOpsPolicy } from "@/lib/rbac/ops-access";
import { evaluateCapability } from "@/lib/rbac/access-evaluator";
import { resolveOpsLevels } from "@/lib/rbac/ops-policy";
import { reserveRateLimit } from "@/lib/ai/provider/store";
import { AGENT_LIMITS, AGENT_SCOPES, isAgentScopeKey, type AgentScopeKey } from "./scopes";
import { AGENT_WRITE_SCOPES, isAgentWriteScopeKey, type AgentWriteScopeKey } from "./write-scopes";

export const AGENT_TOKEN_PREFIX = "snk_agent_";
export const AGENTS_PAUSED_KEY = "agents_paused_v1";

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A new random token (256 bits). Only its hash is stored; the token is shown once. */
export function newAgentToken(): { token: string; prefix: string; hash: string } {
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, prefix: token.slice(0, AGENT_TOKEN_PREFIX.length + 6), hash: hashAgentToken(token) };
}

/**
 * The packs a person can hand to (or keep giving) an agent, read live: an
 * active ADMIN can read every pack; an active OPS_MANAGER only packs whose
 * area is at least "read" in their current access (and the capability where
 * one is needed); anyone else, or a deactivated or deleted account, none.
 */
export async function readableScopesFor(userId: string): Promise<AgentScopeKey[]> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, role: true, extraRoles: { select: { role: true } } } });
  if (!user?.isActive) return [];
  const roles = heldRoles(user.role, user.extraRoles.map((row) => row.role));
  if (roles.includes(Role.ADMIN)) return AGENT_SCOPES.map((scope) => scope.key);
  if (!roles.includes(Role.OPS_MANAGER)) return [];
  const policy = await getOpsPolicy();
  const levels = resolveOpsLevels(policy, user.id);
  const subject = { id: user.id, role: String(user.role), heldRoles: roles.map(String) };
  return AGENT_SCOPES
    .filter((scope) => levels[scope.opsArea] !== "off" && (!scope.capability || evaluateCapability(policy, subject, scope.capability)))
    .map((scope) => scope.key);
}

/**
 * The write packs a person can hand to (or keep giving) an agent, read live:
 * an active ADMIN every pack; an active OPS_MANAGER only packs whose areas are
 * all at "manage" in their current access (and the capability where named);
 * anyone else, or a deactivated or deleted account, none.
 */
export async function manageableWriteScopesFor(userId: string): Promise<AgentWriteScopeKey[]> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, role: true, extraRoles: { select: { role: true } } } });
  if (!user?.isActive) return [];
  const roles = heldRoles(user.role, user.extraRoles.map((row) => row.role));
  if (roles.includes(Role.ADMIN)) return AGENT_WRITE_SCOPES.map((scope) => scope.key);
  if (!roles.includes(Role.OPS_MANAGER)) return [];
  const policy = await getOpsPolicy();
  const levels = resolveOpsLevels(policy, user.id);
  const subject = { id: user.id, role: String(user.role), heldRoles: roles.map(String) };
  return AGENT_WRITE_SCOPES
    .filter((scope) => scope.opsAreas.every((area) => levels[area] === "manage") && (!scope.capability || evaluateCapability(policy, subject, scope.capability)))
    .map((scope) => scope.key);
}

/** What the agent may ASK for right now: its write packs that its creator can still manage. */
export async function effectiveAgentWriteScopes(agent: { writeAreas?: string[] | null; createdById: string }): Promise<{ effective: AgentWriteScopeKey[]; withheld: AgentWriteScopeKey[] }> {
  const requested = (agent.writeAreas ?? []).filter(isAgentWriteScopeKey);
  if (requested.length === 0) return { effective: [], withheld: [] };
  const creator = new Set(await manageableWriteScopesFor(agent.createdById));
  return { effective: requested.filter((key) => creator.has(key)), withheld: requested.filter((key) => !creator.has(key)) };
}

/** What the agent may read right now: its packs that its creator can still read. */
export async function effectiveAgentScopes(agent: { areas: string[]; createdById: string }): Promise<{ effective: AgentScopeKey[]; withheld: AgentScopeKey[] }> {
  const requested = agent.areas.filter(isAgentScopeKey);
  const creator = new Set(await readableScopesFor(agent.createdById));
  return { effective: requested.filter((key) => creator.has(key)), withheld: requested.filter((key) => !creator.has(key)) };
}

export type AgentContext = {
  agentId: string;
  agentName: string;
  tokenId: string;
  creatorId: string;
  expiresAt: Date;
  scopes: AgentScopeKey[];
  withheld: AgentScopeKey[];
  /** Write packs (ask only; every write waits for a person's approval). */
  writeScopes: AgentWriteScopeKey[];
  writeWithheld: AgentWriteScopeKey[];
};

export type AgentAuthCode = "MISSING_TOKEN" | "INVALID_TOKEN" | "EXPIRED" | "REVOKED" | "AGENTS_PAUSED" | "CREATOR_INACTIVE" | "RATE_LIMITED" | "DAILY_BUDGET";

export class AgentAuthError extends Error {
  constructor(public status: number, public code: AgentAuthCode, message: string, public agentId: string | null = null, public tokenId: string | null = null) {
    super(message);
    this.name = "AgentAuthError";
  }
}

export async function agentsPaused(): Promise<boolean> {
  const row = await db.appSetting.findUnique({ where: { key: AGENTS_PAUSED_KEY } });
  const value = row?.value as { paused?: unknown } | undefined;
  return value?.paused === true;
}

/**
 * Authenticates one agent request from its bearer token, with the same live
 * checks a session gets: token known, not revoked, not expired; agent active;
 * the global pause off; the creator still active with access; then the shared
 * per-minute and per-day limits. Never reads cookies, never calls the app
 * over HTTP.
 */
export async function authenticateAgent(authorization: string | null, now = new Date()): Promise<AgentContext> {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  const token = match?.[1] ?? "";
  if (!token) throw new AgentAuthError(401, "MISSING_TOKEN", "Send the agent token as: Authorization: Bearer <token>.");
  if (!token.startsWith(AGENT_TOKEN_PREFIX) || token.length > 200) throw new AgentAuthError(401, "INVALID_TOKEN", "This token is not valid.");
  const row = await db.agentToken.findUnique({ where: { tokenHash: hashAgentToken(token) }, include: { agent: true } });
  if (!row) throw new AgentAuthError(401, "INVALID_TOKEN", "This token is not valid.");
  if (row.revokedAt || row.agent.status !== "ACTIVE") throw new AgentAuthError(401, "REVOKED", "This token was revoked.", row.agentId, row.id);
  if (row.expiresAt.getTime() <= now.getTime()) throw new AgentAuthError(401, "EXPIRED", "This token has expired. Ask an administrator to rotate it.", row.agentId, row.id);
  if (await agentsPaused()) throw new AgentAuthError(503, "AGENTS_PAUSED", "All agents are paused by an administrator.", row.agentId, row.id);
  const { effective, withheld } = await effectiveAgentScopes(row.agent);
  const creatorScopes = await readableScopesFor(row.agent.createdById);
  if (creatorScopes.length === 0) throw new AgentAuthError(403, "CREATOR_INACTIVE", "The administrator who created this agent no longer has access.", row.agentId, row.id);
  if (!(await reserveRateLimit(`agent-token:${row.id}:minute`, AGENT_LIMITS.perMinute, 60_000, now))) throw new AgentAuthError(429, "RATE_LIMITED", "Too many requests. Wait a minute.", row.agentId, row.id);
  if (!(await reserveRateLimit(`agent-token:${row.id}:day`, AGENT_LIMITS.perDay, 86_400_000, now))) throw new AgentAuthError(429, "DAILY_BUDGET", "This token's daily request budget is used up.", row.agentId, row.id);
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.agentToken.updateMany({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
  const writes = await effectiveAgentWriteScopes(row.agent);
  return { agentId: row.agentId, agentName: row.agent.name, tokenId: row.id, creatorId: row.agent.createdById, expiresAt: row.expiresAt, scopes: effective, withheld, writeScopes: writes.effective, writeWithheld: writes.withheld };
}
