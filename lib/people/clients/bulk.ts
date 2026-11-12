import "server-only";
import { db } from "@/lib/db";
import { sendLifecycleEmail } from "@/lib/notifications/lifecycle";
import type { ClientBulkRequest, ClientBulkResponse, ClientBulkResult } from "./bulk-types";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function messageHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

async function sendUpdate(clientId: string, subject: string, message: string): Promise<ClientBulkResult> {
  try {
    const result = await sendLifecycleEmail({ clientId, jobId: null, stage: "CUSTOM", mode: "manual", extra: { subject, bodyHtml: messageHtml(message) } });
    if (result.sent) return { id: clientId, outcome: "done", message: `Sent to ${result.recipients.length} recipient${result.recipients.length === 1 ? "" : "s"}.` };
    const reason = result.skipped === "no-recipients" || result.skipped === "no-client" ? "No client email on file." : `Not sent (${result.skipped ?? "unknown reason"}).`;
    return { id: clientId, outcome: "refused", message: reason };
  } catch (error) {
    return { id: clientId, outcome: "refused", message: error instanceof Error ? error.message : "The email could not be sent." };
  }
}

/** Same effect and audit as DELETE /api/admin/clients/[id] (the PIN was checked by the route). */
async function markInactive(actorId: string, clientId: string): Promise<ClientBulkResult> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { isActive: true } });
  if (!client) return { id: clientId, outcome: "refused", message: "Client not found." };
  if (!client.isActive) return { id: clientId, outcome: "unchanged", message: "Already inactive." };
  await db.client.update({ where: { id: clientId }, data: { isActive: false } });
  await db.auditLog.create({ data: { userId: actorId, action: "DEACTIVATE_CLIENT", entity: "Client", entityId: clientId, after: { origin: "PEOPLE_BULK" } } });
  return { id: clientId, outcome: "done", message: "Marked inactive." };
}

export async function runClientBulk(actorId: string, request: ClientBulkRequest): Promise<ClientBulkResponse> {
  const ids = Array.from(new Set(request.ids));
  const results: ClientBulkResult[] = [];
  // One at a time: each send or change gets its own honest outcome.
  for (const id of ids) {
    if (request.action === "send-update") results.push(await sendUpdate(id, request.subject ?? "", request.message ?? ""));
    else results.push(await markInactive(actorId, id));
  }
  return { action: request.action, results };
}
