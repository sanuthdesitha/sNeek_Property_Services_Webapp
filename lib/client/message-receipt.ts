import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { getTransactionAppSettings } from "@/lib/settings";
import { auditClientPortalAction, propertyScopeWhere, requireClientPortal, type ClientPortalContext } from "@/lib/auth/client-portal";
export class ClientMessageError extends Error { constructor(public status: number, message: string) { super(message); } }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function clientMessageContext(portal: ClientPortalContext, jobId: string | null) {
  const session = await requireSession();
  if (session.user.id !== portal.userId) throw new ClientMessageError(409, "Account context changed. Reload messages.");
  return { context: digest(["client-message-v1", portal.userId, portal.clientId, portal.actor, portal.team?.id ?? null, portal.propertyIds ? [...portal.propertyIds].sort() : null,
    Object.entries(portal.permissions).sort(([a], [b]) => a.localeCompare(b)), Object.entries(portal.visibility).sort(([a], [b]) => a.localeCompare(b)),
    session.impersonation?.actorId ?? null, session.impersonation?.mode ?? null, session.impersonation?.startedAt ?? null, jobId]), session };
}
const sentBy = { select: { id: true, name: true, email: true, role: true } };
export async function saveClientMessage(input: { portal: ClientPortalContext; body: string; jobId: string | null; requestId?: string; context?: string | null }) {
  const initial = await clientMessageContext(input.portal, input.jobId);
  if (initial.session.impersonation?.mode === "READ_ONLY") throw new ClientMessageError(403, "Messages cannot be sent in read-only impersonation mode.");
  if (input.requestId && (!input.context || input.context !== initial.context)) throw new ClientMessageError(409, "Message context changed. Reload the thread before sending.");
  const receiptId = input.requestId ? `cm_${digest([input.portal.userId, input.portal.clientId, input.jobId, initial.context, input.requestId])}` : undefined;
  return db.$transaction(async tx => {
    if (receiptId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${receiptId}))`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.portal.userId} FOR SHARE`;
    const user = await tx.user.findUnique({ where: { id: input.portal.userId }, select: { vaTeamId: true, clientId: true } });
    if (!user) throw new ClientMessageError(403, "Account is unavailable.");
    if (user.vaTeamId) await tx.$queryRaw`SELECT "id" FROM "VaTeam" WHERE "id" = ${user.vaTeamId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${input.portal.clientId} FOR SHARE`;
    await tx.$queryRaw`SELECT "key" FROM "AppSetting" WHERE "key" = 'app' FOR SHARE`;
    const portal = await requireClientPortal({ permission: "messages", settings: await getTransactionAppSettings(tx) });
    const fresh = await clientMessageContext(portal, input.jobId);
    if (fresh.context !== initial.context) throw new ClientMessageError(409, "Message context changed. Reload the thread before sending.");
    const client = await tx.client.findUnique({ where: { id: portal.clientId }, select: { id: true, name: true } });
    if (!client) throw new ClientMessageError(404, "Client not found.");
    let job: { id: string; jobNumber: string | null; property: { name: string } } | null = null;
    if (input.jobId) {
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${input.jobId} FOR SHARE`;
      const selected = await tx.job.findUnique({ where: { id: input.jobId }, select: { propertyId: true } });
      if (selected) await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${selected.propertyId} FOR SHARE`;
      job = await tx.job.findFirst({ where: { id: input.jobId, property: propertyScopeWhere(portal) }, select: { id: true, jobNumber: true, property: { select: { name: true } } } });
      if (!job) throw new ClientMessageError(404, "Job not found.");
    }
    if (receiptId) {
      const existing = await tx.clientMessage.findUnique({ where: { id: receiptId }, include: { sentBy } });
      if (existing) {
        if (existing.body !== input.body || existing.clientId !== portal.clientId || existing.sentById !== portal.userId || existing.jobId !== input.jobId || existing.isFromAdmin) throw new ClientMessageError(409, "This send request was already used for different message content.");
        return { message: existing, client, job, duplicated: true };
      }
    }
    const message = await tx.clientMessage.create({ data: { ...(receiptId ? { id: receiptId } : {}), clientId: client.id, jobId: input.jobId, sentById: portal.userId, body: input.body, isFromAdmin: false }, include: { sentBy } });
    await auditClientPortalAction({ ctx: portal, action: "message.post", entity: "ClientMessage", entityId: message.id, after: { jobId: input.jobId, requestId: input.requestId ?? null, impersonationActorId: fresh.session.impersonation?.actorId ?? null, impersonationMode: fresh.session.impersonation?.mode ?? null } }, tx);
    return { message, client, job, duplicated: false };
  }, { timeout: 15000 });
}
