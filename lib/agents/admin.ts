import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AGENTS_PAUSED_KEY, agentsPaused, effectiveAgentScopes, effectiveAgentWriteScopes, manageableWriteScopesFor, newAgentToken, readableScopesFor } from "./access";
import { AGENT_MAX_EXPIRY_DAYS, AGENT_SCOPE_KEYS, type AgentScopeKey } from "./scopes";
import { AGENT_WRITE_SCOPE_KEYS, type AgentWriteScopeKey } from "./write-scopes";

/** Administrator actions on agents. Callers have already checked ADMIN, not impersonating, and the person's own PIN. */

export class AgentAdminError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "AgentAdminError"; }
}

const scopeList = z.array(z.enum(AGENT_SCOPE_KEYS as unknown as [AgentScopeKey, ...AgentScopeKey[]])).min(1).max(AGENT_SCOPE_KEYS.length);
const writeScopeList = z.array(z.enum(AGENT_WRITE_SCOPE_KEYS as unknown as [AgentWriteScopeKey, ...AgentWriteScopeKey[]])).max(AGENT_WRITE_SCOPE_KEYS.length);
export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  areas: scopeList,
  /** Write packs: default none. */
  writeAreas: writeScopeList.optional(),
  expiresInDays: z.number().int().min(1).max(AGENT_MAX_EXPIRY_DAYS),
}).strict();
export const writeAreasSchema = z.object({ writeAreas: writeScopeList }).strict();

/** Refuses write packs wider than the administrator's own live MANAGE access. */
async function assertGrantableWrites(writeAreas: AgentWriteScopeKey[], adminId: string): Promise<void> {
  if (writeAreas.length === 0) return;
  const allowed = new Set(await manageableWriteScopesFor(adminId));
  const wider = writeAreas.filter((area) => !allowed.has(area));
  if (wider.length) throw new AgentAdminError(403, `You cannot let an agent ask for changes you cannot make yourself: ${wider.join(", ")}.`);
}
export const rotateAgentSchema = z.object({ expiresInDays: z.number().int().min(1).max(AGENT_MAX_EXPIRY_DAYS) }).strict();

function expiry(days: number, now: Date) {
  return new Date(now.getTime() + days * 86_400_000);
}

/** The new token is returned once and never stored. */
export async function createAgent(raw: unknown, adminId: string, now = new Date()): Promise<{ agentId: string; token: string; prefix: string; expiresAt: string }> {
  const input = createAgentSchema.parse(raw);
  const areas = Array.from(new Set(input.areas));
  const allowed = new Set(await readableScopesFor(adminId));
  const wider = areas.filter((area) => !allowed.has(area));
  if (wider.length) throw new AgentAdminError(403, `You cannot give an agent access you do not have: ${wider.join(", ")}.`);
  const writeAreas = Array.from(new Set(input.writeAreas ?? []));
  await assertGrantableWrites(writeAreas, adminId);
  const issued = newAgentToken();
  const expiresAt = expiry(input.expiresInDays, now);
  const agent = await db.$transaction(async (tx) => {
    const created = await tx.agentProfile.create({ data: { name: input.name, createdById: adminId, areas, writeAreas } });
    await tx.agentToken.create({ data: { agentId: created.id, tokenHash: issued.hash, prefix: issued.prefix, expiresAt, createdById: adminId } });
    await tx.auditLog.create({ data: { userId: adminId, action: "AGENT_CREATED", entity: "AgentProfile", entityId: created.id, after: { name: input.name, areas, writeAreas, tokenPrefix: issued.prefix, expiresAt: expiresAt.toISOString() } } });
    return created;
  });
  return { agentId: agent.id, token: issued.token, prefix: issued.prefix, expiresAt: expiresAt.toISOString() };
}

/** Revokes every live token of the agent and issues a new one, in one transaction. */
export async function rotateAgentToken(agentId: string, raw: unknown, adminId: string, now = new Date()): Promise<{ token: string; prefix: string; expiresAt: string }> {
  const input = rotateAgentSchema.parse(raw);
  const issued = newAgentToken();
  const expiresAt = expiry(input.expiresInDays, now);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent:${agentId}`}))`;
    const agent = await tx.agentProfile.findUnique({ where: { id: agentId } });
    if (!agent || agent.status !== "ACTIVE") throw new AgentAdminError(409, "This agent is revoked or no longer exists.");
    const revoked = await tx.agentToken.updateMany({ where: { agentId, revokedAt: null }, data: { revokedAt: now } });
    await tx.agentToken.create({ data: { agentId, tokenHash: issued.hash, prefix: issued.prefix, expiresAt, createdById: adminId } });
    await tx.auditLog.create({ data: { userId: adminId, action: "AGENT_TOKEN_ROTATED", entity: "AgentProfile", entityId: agentId, after: { tokenPrefix: issued.prefix, expiresAt: expiresAt.toISOString(), previousTokensRevoked: revoked.count } } });
  });
  return { token: issued.token, prefix: issued.prefix, expiresAt: expiresAt.toISOString() };
}

/** Immediate: the next request with any of its tokens is refused. */
export async function revokeAgent(agentId: string, adminId: string, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
    const agent = await tx.agentProfile.findUnique({ where: { id: agentId } });
    if (!agent) throw new AgentAdminError(404, "Agent not found.");
    if (agent.status === "REVOKED") return;
    await tx.agentProfile.update({ where: { id: agentId }, data: { status: "REVOKED", revokedAt: now, revokedById: adminId } });
    await tx.agentToken.updateMany({ where: { agentId, revokedAt: null }, data: { revokedAt: now } });
    await tx.auditLog.create({ data: { userId: adminId, action: "AGENT_REVOKED", entity: "AgentProfile", entityId: agentId, after: { name: agent.name } } });
  });
}

/**
 * Sets which write packs an agent may ask for (default none). Never wider
 * than the administrator's own live MANAGE access; requests already waiting
 * are re-checked against the agent's packs when someone approves them.
 */
export async function setAgentWriteAreas(agentId: string, raw: unknown, adminId: string): Promise<{ writeAreas: AgentWriteScopeKey[] }> {
  const writeAreas = Array.from(new Set(writeAreasSchema.parse(raw).writeAreas));
  await assertGrantableWrites(writeAreas, adminId);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent:${agentId}`}))`;
    const agent = await tx.agentProfile.findUnique({ where: { id: agentId } });
    if (!agent || agent.status !== "ACTIVE") throw new AgentAdminError(409, "This agent is revoked or no longer exists.");
    await tx.agentProfile.update({ where: { id: agentId }, data: { writeAreas } });
    await tx.auditLog.create({ data: { userId: adminId, action: "AGENT_WRITE_AREAS_CHANGED", entity: "AgentProfile", entityId: agentId, before: { writeAreas: agent.writeAreas }, after: { writeAreas } } });
  });
  return { writeAreas };
}

/** Global kill switch for every agent. */
export async function setAgentsPaused(paused: boolean, adminId: string, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
    const value = { paused, changedById: adminId, changedAt: now.toISOString() };
    await tx.appSetting.upsert({ where: { key: AGENTS_PAUSED_KEY }, create: { key: AGENTS_PAUSED_KEY, value }, update: { value } });
    await tx.auditLog.create({ data: { userId: adminId, action: paused ? "AGENTS_PAUSED" : "AGENTS_RESUMED", entity: "AppSetting", entityId: AGENTS_PAUSED_KEY, after: { paused } } });
  });
}

export type AgentListItem = {
  id: string; name: string; status: string; createdAt: string; createdBy: string; areas: string[];
  effective: AgentScopeKey[]; withheld: AgentScopeKey[];
  writeAreas: string[]; writeEffective: AgentWriteScopeKey[]; writeWithheld: AgentWriteScopeKey[];
  waitingRequests: number;
  token: { prefix: string; expiresAt: string; lastUsedAt: string | null; expired: boolean } | null;
  recentCalls: { at: string; method: string; tool: string | null; outcome: string; errorCode: string | null; latencyMs: number; resultBytes: number | null }[];
};

export async function listAgents(now = new Date()): Promise<{ paused: boolean; agents: AgentListItem[] }> {
  const agents = await db.agentProfile.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100, include: { tokens: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1 } } });
  const creators = await db.user.findMany({ where: { id: { in: Array.from(new Set(agents.map((agent) => agent.createdById))) } }, select: { id: true, name: true, email: true } });
  const items = await Promise.all(agents.map(async (agent): Promise<AgentListItem> => {
    const scopes = agent.status === "ACTIVE" ? await effectiveAgentScopes(agent) : { effective: [], withheld: [] };
    const writes = agent.status === "ACTIVE" ? await effectiveAgentWriteScopes(agent) : { effective: [], withheld: [] };
    const waitingRequests = await db.agentActionRequest.count({ where: { agentId: agent.id, status: "WAITING", expiresAt: { gt: now } } });
    const calls = await db.agentAuditEntry.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: "desc" }, take: 10, select: { createdAt: true, method: true, tool: true, outcome: true, errorCode: true, latencyMs: true, resultBytes: true } });
    const token = agent.tokens[0];
    const creator = creators.find((user) => user.id === agent.createdById);
    return {
      id: agent.id, name: agent.name, status: agent.status, createdAt: agent.createdAt.toISOString(),
      createdBy: creator?.name ?? creator?.email ?? "Removed account", areas: agent.areas,
      effective: scopes.effective, withheld: scopes.withheld,
      writeAreas: agent.writeAreas ?? [], writeEffective: writes.effective, writeWithheld: writes.withheld, waitingRequests,
      token: token ? { prefix: token.prefix, expiresAt: token.expiresAt.toISOString(), lastUsedAt: token.lastUsedAt?.toISOString() ?? null, expired: token.expiresAt <= now } : null,
      recentCalls: calls.map((call) => ({ at: call.createdAt.toISOString(), method: call.method, tool: call.tool, outcome: call.outcome, errorCode: call.errorCode, latencyMs: call.latencyMs, resultBytes: call.resultBytes })),
    };
  }));
  return { paused: await agentsPaused(), agents: items };
}
